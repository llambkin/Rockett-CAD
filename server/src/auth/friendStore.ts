import { JsonStore, newId, StoreError } from "../store/jsonStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import type { Storage } from "../store/storage.js";

interface FriendRequest {
  id: string;
  from: string;
  email: string;
}

interface Friendship {
  a: string;
  b: string;
}

interface FriendsFile {
  version: 1;
  requests: FriendRequest[];
  friends: Friendship[];
}

const KEY = "users";

function validate(file: FriendsFile): void {
  if (
    file.version !== 1 ||
    !Array.isArray(file.requests) ||
    !Array.isArray(file.friends) ||
    file.requests.some(
      (request) =>
        typeof request.id !== "string" ||
        typeof request.from !== "string" ||
        typeof request.email !== "string",
    ) ||
    file.friends.some(
      (friend) => typeof friend.a !== "string" || typeof friend.b !== "string",
    )
  )
    throw new StoreError("friends.json is corrupted", "internal");
}

export class FriendStore {
  private readonly file: JsonStore<FriendsFile>;
  private readonly queue = new ProjectQueue();

  constructor(storage: Storage) {
    this.file = new JsonStore({
      storage,
      root: "",
      name: "friends",
      key: /^users$/,
      file: () => "friends.json",
      migrations: {
        namespace: "friends",
        current: 1,
        field: "version",
        steps: {},
      },
      validate,
    });
  }

  async list(): Promise<FriendsFile> {
    try {
      const file = await this.file.read(KEY);
      validate(file);
      return file;
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return { version: 1, requests: [], friends: [] };
      throw err;
    }
  }

  async friendIds(userId: string): Promise<Set<string>> {
    return new Set(
      (await this.list()).friends.flatMap((friend) =>
        friend.a === userId
          ? [friend.b]
          : friend.b === userId
            ? [friend.a]
            : [],
      ),
    );
  }

  request(from: string, email: string, targetId?: string): Promise<void> {
    return this.change((file) => {
      if (
        file.requests.some(
          (request) => request.from === from && request.email === email,
        ) ||
        (targetId &&
          file.friends.some(
            (friend) =>
              (friend.a === from && friend.b === targetId) ||
              (friend.a === targetId && friend.b === from),
          ))
      )
        throw new StoreError("friend request already exists", "conflict");
      file.requests.push({
        id: newId(),
        from,
        email,
      });
    });
  }

  answer(
    id: string,
    recipient: string,
    email: string,
    accept: boolean,
    senderEmail?: string,
  ): Promise<void> {
    return this.change((file) => {
      const request = file.requests.find(
        (item) => item.id === id && item.email === email,
      );
      if (!request)
        throw new StoreError("friend request not found", "not_found");
      file.requests = file.requests.filter((item) => item.id !== id);
      if (accept) {
        if (request.from === recipient)
          throw new StoreError("cannot befriend yourself", "conflict");
        if (
          !file.friends.some(
            (friend) =>
              (friend.a === request.from && friend.b === recipient) ||
              (friend.a === recipient && friend.b === request.from),
          )
        )
          file.friends.push({ a: request.from, b: recipient });
        if (senderEmail)
          file.requests = file.requests.filter(
            (item) => !(item.from === recipient && item.email === senderEmail),
          );
      }
    });
  }

  cancel(id: string, sender: string): Promise<void> {
    return this.change((file) => {
      const index = file.requests.findIndex(
        (item) => item.id === id && item.from === sender,
      );
      if (index < 0)
        throw new StoreError("friend request not found", "not_found");
      file.requests.splice(index, 1);
    });
  }

  remove(
    userId: string,
    friendId: string,
    revoke: () => Promise<void>,
  ): Promise<void> {
    return this.queue.run(KEY, async () => {
      const file = await this.list();
      const friends = file.friends.filter(
        (friend) =>
          (friend.a === userId && friend.b === friendId) ||
          (friend.a === friendId && friend.b === userId),
      );
      if (!friends.length)
        throw new StoreError("friend not found", "not_found");
      await revoke();
      file.friends = file.friends.filter((friend) => !friends.includes(friend));
      await this.file.write(KEY, file);
    });
  }

  private change(edit: (file: FriendsFile) => void): Promise<void> {
    return this.queue.run(KEY, async () => {
      const file = await this.list();
      edit(file);
      await this.file.write(KEY, file);
    });
  }
}
