import { Type, type Static } from "typebox";
import { NAME_LENGTH } from "./features.js";

export const FOLDERS_VERSION = 2;

export const folderId = Type.String({ minLength: 1, maxLength: 100 });
export const folderName = Type.String({
  minLength: 1,
  maxLength: NAME_LENGTH,
});
const parentId = Type.Union([folderId, Type.Null()]);
export const folderMembers = Type.Object({
  owner: Type.Union([Type.String(), Type.Null()]),
  members: Type.Array(
    Type.Object({
      userId: Type.String(),
      role: Type.Union([Type.Literal("view"), Type.Literal("edit")]),
    }),
  ),
});

export const createFolderBody = Type.Object({
  name: folderName,
  parentId: Type.Optional(parentId),
});

export const updateFolderBody = Type.Object({
  name: Type.Optional(folderName),
  parentId: Type.Optional(parentId),
});

export const placeProjectBody = Type.Object({ folderId: parentId });

export const foldersFile = Type.Object({
  version: Type.Literal(FOLDERS_VERSION),
  folders: Type.Array(
    Type.Object({
      id: folderId,
      name: folderName,
      parentId,
      owner: folderMembers.properties.owner,
      members: folderMembers.properties.members,
    }),
  ),
  placement: Type.Record(Type.String(), folderId),
});

export type FoldersFile = Static<typeof foldersFile>;
