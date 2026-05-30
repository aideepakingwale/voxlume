const accountStorageKey = `${import.meta.env.VITE_STORAGE_PREFIX || "voxlume"}-account`;
const superadminStorageKey = `${import.meta.env.VITE_STORAGE_PREFIX || "voxlume"}-superadmin`;

function readJsonStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getTenantAuth() {
  return readJsonStorage(accountStorageKey);
}

function getSuperadminAuth() {
  return readJsonStorage(superadminStorageKey);
}

function authHeadersForPath(path) {
  if (path.startsWith("/api/superadmin/")) {
    const auth = getSuperadminAuth();
    return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  }
  if (path.startsWith("/api/events") || path.startsWith("/api/admin")) {
    const auth = getTenantAuth() || getSuperadminAuth();
    return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  }
  return {};
}

export {
  accountStorageKey,
  authHeadersForPath,
  getSuperadminAuth,
  getTenantAuth,
  readJsonStorage,
  superadminStorageKey,
  writeJsonStorage,
};
