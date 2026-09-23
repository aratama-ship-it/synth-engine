// Latest-intent wins. A newer load, edit, INIT or undo invalidates pending reads.
export function createPatchLoadState() {
  let revision = 0;
  return {
    begin() { revision += 1; return revision; },
    invalidate() { revision += 1; },
    isCurrent(ticket) { return ticket === revision; },
  };
}
