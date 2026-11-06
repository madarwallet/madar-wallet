import { ANDROID } from "./index";
import * as android from "./android/update";
import * as ext from "./extension/update";

export type { UpdateState } from "./android/update";
const side = ANDROID ? android : ext;
export const checkUpdate = (force: boolean) => void side.checkUpdate(force);
export const startUpdate = () => side.startUpdate();
export const offeredVersion = () => side.offeredVersion();
export const useUpdate = () => side.useUpdate();
