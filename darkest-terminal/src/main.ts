import { createCliRenderer } from "@opentui/core";
import { App } from "./ui/app";

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  new App(renderer);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
