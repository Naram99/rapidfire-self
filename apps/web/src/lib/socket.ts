import type {
  Ack,
  ClientEvents,
  Command,
  ServerEvents,
} from '@rapidfire/contracts';
import type { Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerEvents, ClientEvents>;
// Keep correlated event/payload pairs typed without a cast across a union.
export function emitCommand(
  socket: GameSocket,
  command: Command,
  acknowledge: (ack: Ack) => void,
): void {
  switch (command.type) {
    case 'room:create':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'room:join':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'room:leave':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'room:settings:update':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'room:ready':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'solo:start':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'match:leave':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'category:select':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'answer:submit':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'state:sync':
      socket.emit(command.type, command.payload, acknowledge);
      break;
    case 'time:sync':
      socket.emit(command.type, command.payload, acknowledge);
      break;
  }
}
