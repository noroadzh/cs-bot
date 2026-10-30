const KEY = 'csbot.console.basic';

export function encodeBasic(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function saveCredentials(user: string, password: string): void {
  sessionStorage.setItem(KEY, encodeBasic(user, password));
}

export function clearCredentials(): void {
  sessionStorage.removeItem(KEY);
}

export function authHeader(): string | null {
  const token = sessionStorage.getItem(KEY);
  return token ? `Basic ${token}` : null;
}

export function hasCredentials(): boolean {
  return authHeader() !== null;
}
