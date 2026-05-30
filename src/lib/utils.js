export function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

export function getParticipantId(storagePrefix = "voxlume") {
  const key = `${storagePrefix}-participant-id`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
  }
  return id;
}
