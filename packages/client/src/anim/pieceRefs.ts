/** Registro de nodos DOM por id de pieza, para animarlos con la Web Animations API. */
const refs = new Map<string, HTMLElement>();

export const registerPiece = (id: string, el: HTMLElement | null): void => {
  if (el) refs.set(id, el);
  else refs.delete(id);
};

export const pieceElement = (id: string): HTMLElement | null => refs.get(id) ?? null;
