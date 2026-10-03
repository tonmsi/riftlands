// Windows terminates Node directly for child.kill('SIGTERM'). Use IPC only in this
// test launcher to exercise the real signal handler without adding a server route.
import '../../server/index';
process.on('message', message => { if (message === 'shutdown') process.emit('SIGTERM'); });
