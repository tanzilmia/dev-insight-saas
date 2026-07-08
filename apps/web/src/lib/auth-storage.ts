export const tokenStorageKey = "devinsight.accessToken";

export function getStoredToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(tokenStorageKey);
}

export function storeToken(token: string) {
  window.localStorage.setItem(tokenStorageKey, token);
}

export function clearStoredToken() {
  window.localStorage.removeItem(tokenStorageKey);
}

