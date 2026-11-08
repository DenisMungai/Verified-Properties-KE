/** "3 unread messages": the accessible label for unread counts (badges and inbox rows). */
export function unreadLabel(count: number): string {
  return `${count} unread ${count === 1 ? "message" : "messages"}`;
}
