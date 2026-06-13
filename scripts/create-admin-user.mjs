import { createClient } from "@supabase/supabase-js";

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD"
];

const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error(`Missing required env vars: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

const { data: existingUsers, error: listError } =
  await supabase.auth.admin.listUsers();

if (listError) {
  console.error(listError.message);
  process.exit(1);
}

const existingUser = existingUsers.users.find((user) => user.email === email);

if (existingUser) {
  const { error: updateError } = await supabase.auth.admin.updateUserById(
    existingUser.id,
    {
      password,
      email_confirm: true,
      app_metadata: {
        ...(existingUser.app_metadata ?? {}),
        role: "admin"
      },
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        role: "admin"
      }
    }
  );

  if (updateError) {
    console.error(updateError.message);
    process.exit(1);
  }

  console.log(`Updated existing admin user: ${email}`);
  process.exit(0);
}

const { error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: {
    role: "admin"
  },
  user_metadata: {
    role: "admin"
  }
});

if (createError) {
  console.error(createError.message);
  process.exit(1);
}

console.log(`Created admin user: ${email}`);
