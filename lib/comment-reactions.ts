import type { createAdminClient } from "@/lib/supabase/admin";

export const COMMENT_REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"] as const;
export type CommentReactionEmoji = (typeof COMMENT_REACTION_EMOJIS)[number];

export type CommentReactionUser = {
  id: string;
  name: string;
};

export type CommentReactionGroup = {
  emoji: CommentReactionEmoji;
  count: number;
  reacted_by_me: boolean;
  users: CommentReactionUser[];
};

export function isCommentReactionEmoji(value: unknown): value is CommentReactionEmoji {
  return typeof value === "string" && (COMMENT_REACTION_EMOJIS as readonly string[]).includes(value);
}

type ReactionRow = {
  comment_id: string;
  user_id: string;
  emoji: string;
};

/** Loads reaction groups for a set of comments, keyed by comment id. */
export async function loadCommentReactionGroups(
  db: ReturnType<typeof createAdminClient>,
  table: "lead_comment_reactions" | "campaign_comment_reactions",
  commentIds: string[],
  currentUserId: string,
): Promise<Map<string, CommentReactionGroup[]>> {
  const byComment = new Map<string, CommentReactionGroup[]>();
  if (commentIds.length === 0) return byComment;

  const { data } = await db
    .from(table)
    .select("comment_id, user_id, emoji")
    .in("comment_id", commentIds);

  const rows = (data ?? []) as ReactionRow[];
  if (rows.length === 0) return byComment;

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const profile of profiles ?? []) {
      names.set(
        profile.id as string,
        (profile.full_name || profile.email || "Team member") as string,
      );
    }
  }

  type Acc = Map<string, Map<CommentReactionEmoji, CommentReactionUser[]>>;
  const acc: Acc = new Map();

  for (const row of rows) {
    if (!isCommentReactionEmoji(row.emoji)) continue;
    let perComment = acc.get(row.comment_id);
    if (!perComment) {
      perComment = new Map();
      acc.set(row.comment_id, perComment);
    }
    const users = perComment.get(row.emoji) ?? [];
    users.push({
      id: row.user_id,
      name: names.get(row.user_id) ?? "Team member",
    });
    perComment.set(row.emoji, users);
  }

  for (const [commentId, emojiMap] of acc) {
    const groups: CommentReactionGroup[] = [];
    for (const emoji of COMMENT_REACTION_EMOJIS) {
      const users = emojiMap.get(emoji);
      if (!users || users.length === 0) continue;
      groups.push({
        emoji,
        count: users.length,
        reacted_by_me: users.some((u) => u.id === currentUserId),
        users,
      });
    }
    byComment.set(commentId, groups);
  }

  return byComment;
}
