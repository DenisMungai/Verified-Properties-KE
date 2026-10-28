import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address, for example name@example.com." }))
  .refine((value) => value.length <= 254, { error: "Email address is too long." });

const newPassword = z
  .string()
  .min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters.` })
  .max(PASSWORD_MAX, { error: `Use at most ${PASSWORD_MAX} characters.` });

/** Existing passwords are only checked for presence: rules may have changed since they were set. */
const existingPassword = z
  .string()
  .min(1, { error: "Enter your password." })
  .max(PASSWORD_MAX, { error: "Email or password is incorrect." });

export const fullName = z
  .string()
  .trim()
  .min(2, { error: "Enter your full name." })
  .max(80, { error: "Use at most 80 characters." });

export const SIGN_UP_INTENTS = ["find", "list"] as const;
export type SignUpIntent = (typeof SIGN_UP_INTENTS)[number];

export const signInSchema = z.object({
  email,
  password: existingPassword,
});

export const signUpSchema = z.object({
  name: fullName,
  email,
  password: newPassword,
  intent: z.enum(SIGN_UP_INTENTS, { error: "Choose what brings you here." }),
});

export const emailOnlySchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, { error: "This link has expired or was already used." }),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: existingPassword,
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    error: "Choose a password you have not used here before.",
    path: ["newPassword"],
  });

export const accountNameSchema = z.object({ name: fullName });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
