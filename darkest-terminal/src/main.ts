import { createCliRenderer } from "@opentui/core";
import { App } from "./ui/app";
import { PALETTE } from "./ui/theme";

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: PALETTE.bg });
  new App(renderer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
