export function createNoteRegistry(setPressed = (element, pressed) => element?.classList.toggle("is-active", pressed)) {
  const pending = new Map();
  const active = new Map();
  const elementHolds = new Map();
  let generation = 0;

  function holdElement(element) {
    if (!element) return;
    const count = (elementHolds.get(element) ?? 0) + 1;
    elementHolds.set(element, count);
    if (count === 1) setPressed(element, true);
  }

  function releaseElement(element) {
    if (!element) return;
    const count = elementHolds.get(element) ?? 0;
    if (count <= 1) {
      elementHolds.delete(element);
      setPressed(element, false);
      return;
    }
    elementHolds.set(element, count - 1);
  }

  function begin(token, keyElement) {
    if (active.has(token) || pending.has(token)) return undefined;
    const ticket = { token, keyElement, generation, released:false };
    pending.set(token, ticket);
    holdElement(keyElement);
    return ticket;
  }

  function isPending(ticket) {
    return Boolean(ticket) && !ticket.released && ticket.generation === generation && pending.get(ticket.token) === ticket;
  }

  function activate(ticket, node, handle) {
    if (!isPending(ticket)) return false;
    pending.delete(ticket.token);
    active.set(ticket.token, { node, handle, keyElement:ticket.keyElement, generation:ticket.generation });
    return true;
  }

  function cancel(ticket) {
    if (!ticket || pending.get(ticket.token) !== ticket) return false;
    ticket.released = true;
    pending.delete(ticket.token);
    releaseElement(ticket.keyElement);
    return true;
  }

  function release(token) {
    const ticket = pending.get(token);
    if (ticket) cancel(ticket);
    const note = active.get(token);
    if (!note) return undefined;
    active.delete(token);
    releaseElement(note.keyElement);
    return note;
  }

  function drain() {
    generation += 1;
    for (const ticket of pending.values()) {
      ticket.released = true;
      releaseElement(ticket.keyElement);
    }
    pending.clear();
    const notes = [...active.values()];
    for (const note of notes) releaseElement(note.keyElement);
    active.clear();
    return notes;
  }

  function snapshot() {
    return Object.freeze({ pending:pending.size, active:active.size, generation });
  }

  return Object.freeze({ begin, isPending, activate, cancel, release, drain, snapshot });
}
