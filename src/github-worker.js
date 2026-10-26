import { runStampWorker } from './github.js';
import { blockCwdExeSearch } from './windows.js';

// Windows would run a git.exe or gh.exe from the repository folder before the real one.
blockCwdExeSearch();

// Detached from Git's hook so pushes never wait on GitHub.
await runStampWorker(process.argv[2]);
