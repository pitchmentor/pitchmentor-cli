#!/usr/bin/env node
import { text } from "node:stream/consumers";
import { run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2), {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
  env: process.env,
  stdin: () => text(process.stdin),
});
