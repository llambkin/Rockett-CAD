import { FRIEND_ROUTES, NOTICE_ROUTES } from "@rockett/shared";
import { send } from "./api";

export const noticesApi = {
  list: () => send(NOTICE_ROUTES.list, {}),
  openProject: (id: string) => send(NOTICE_ROUTES.openProject, { id }),
  openFolder: (id: string) => send(NOTICE_ROUTES.openFolder, { id }),
  answer: (id: string, accept: boolean) =>
    send(accept ? FRIEND_ROUTES.accept : FRIEND_ROUTES.reject, { id }),
};
