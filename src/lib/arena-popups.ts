export interface ArenaPopup {
  id: string;
  title: string;
  description?: string;
  priority: number;
  sound: boolean;
  receivedAt: number;
}
export function addPopup(queue: ArenaPopup[], event: ArenaPopup) {
  return [
    ...queue.filter(
      (item) =>
        item.id !== event.id && event.receivedAt - item.receivedAt < 30_000,
    ),
    event,
  ]
    .sort((a, b) => b.priority - a.priority || a.receivedAt - b.receivedAt)
    .slice(0, 5);
}
