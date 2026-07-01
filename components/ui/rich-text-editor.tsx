"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Link as LinkIcon, Unlink,
  Heading2,
} from "lucide-react";

function normalizeToHtml(raw: string): string {
  if (!raw) return "";
  // Already HTML — has at least one tag
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw;
  // Plain text: match Gmail's plain-text rendering exactly.
  // \n\n (or more) → <br><br> (blank line), \n → <br> (line break).
  // All in one <p> so TipTap adds no extra block margin between sections.
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return "<p>" + escaped.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>") + "</p>";
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "rounded p-1.5 transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        disabled && "opacity-40 pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "Write your email…",
  className,
  minHeight = 280,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        code: false,
        blockquote: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-400 underline" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeToHtml(value),
    editable: !disabled,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none",
      },
    },
  });

  // Sync external value changes (e.g. switching leads)
  useEffect(() => {
    if (!editor) return;
    const normalized = normalizeToHtml(value);
    if (editor.getHTML() !== normalized) {
      editor.commands.setContent(normalized, { emitUpdate: false });
    }
  }, [editor, value]);

  // Sync disabled prop
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  function addLink() {
    const url = window.prompt("Enter URL");
    if (!url) return;
    editor?.chain().focus().setLink({ href: url }).run();
  }

  if (!editor) return null;

  return (
    <div className={cn("rounded-lg border border-border bg-background overflow-hidden", className)}>
      {/* Toolbar */}
      <div className={cn(
        "flex items-center gap-0.5 border-b border-border px-2 py-1.5 flex-wrap",
        disabled && "opacity-50 pointer-events-none",
      )}>
        <ToolbarButton
          title="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          disabled={disabled}
        >
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          disabled={disabled}
        >
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          disabled={disabled}
        >
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton
          title="Heading"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
        >
          <Heading2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          disabled={disabled}
        >
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          disabled={disabled}
        >
          <ListOrdered className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton title="Add link" onClick={addLink} disabled={disabled}>
          <LinkIcon className="size-3.5" />
        </ToolbarButton>
        {editor.isActive("link") && (
          <ToolbarButton
            title="Remove link"
            onClick={() => editor.chain().focus().unsetLink().run()}
            disabled={disabled}
          >
            <Unlink className="size-3.5" />
          </ToolbarButton>
        )}
      </div>

      {/* Editor content */}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        className={cn(
          "px-4 py-3 text-sm leading-relaxed",
          "[&_.ProseMirror]:outline-none",
          "[&_.ProseMirror]:min-h-[inherit]",
          "[&_.ProseMirror_p]:mt-0 [&_.ProseMirror_p]:mb-[1em]",
          "[&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-1",
          "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:my-1",
          "[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ol]:my-1",
          "[&_.ProseMirror_li]:my-0.5",
          "[&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_.ProseMirror_.is-editor-empty:first-child::before]:text-muted-foreground",
          "[&_.ProseMirror_.is-editor-empty:first-child::before]:float-left",
          "[&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.ProseMirror_.is-editor-empty:first-child::before]:h-0",
          disabled && "opacity-60",
        )}
      />
    </div>
  );
}
