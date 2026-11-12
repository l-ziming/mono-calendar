import { start } from './app.mjs';
start(process.argv[2] || './config.json', process.env).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
