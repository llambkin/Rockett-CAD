import { checkPasswordPolicy, hashPassword } from "./password.js";
import type { UserStore } from "./userStore.js";

export async function resetPassword(
  users: UserStore,
  username: string,
  input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
): Promise<void> {
  const user = await users.findByUsername(username);
  if (!user) throw new Error("User not found");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += chunk.length;
    if (bytes > 1026) throw new Error("Password does not meet policy");
    chunks.push(Buffer.from(chunk));
  }
  const password = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (!checkPasswordPolicy(password))
    throw new Error("Password does not meet policy");
  await users.update(user.id, {
    passwordHash: await hashPassword(password),
    totp: null,
  });
}
