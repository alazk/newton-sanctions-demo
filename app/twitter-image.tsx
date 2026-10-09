// Same image for X/Twitter cards. Config is declared here (not re-exported)
// because Next reads these fields statically from each image route file.
import OpengraphImage from "./opengraph-image";

export const alt =
  "Newton Sanctions Demo: check a wallet before you pay it. Sanctions data from RedStone, enforced by Newton.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function TwitterImage() {
  return OpengraphImage();
}
