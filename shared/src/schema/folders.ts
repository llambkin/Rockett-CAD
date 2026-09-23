import { Type, type Static } from "typebox";

export const FOLDERS_VERSION = 1;

export const folderId = Type.String({ minLength: 1, maxLength: 100 });
export const folderName = Type.String({ minLength: 1, maxLength: 200 });
const parentId = Type.Union([folderId, Type.Null()]);

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
    Type.Object({ id: folderId, name: folderName, parentId }),
  ),
  placement: Type.Record(Type.String(), folderId),
});

export type FoldersFile = Static<typeof foldersFile>;
