import { create } from 'zustand';
import { chooseMove } from '@cm/ai';
import {
  applyMove,
  configFor,
  createGame,
  hypotheticalState,
  legalMoves,
  randomSeed,
  toView,
  type Color,
  type Difficulty,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Move,
  type PieceType,
  type PlayerView,
  type RoomSettings,
  type ServerMessage,
  isValidRoomCode,
  normalizeRoomCode,
  type Square,
  type ConnectIntent,
} from '@cm/engine';
import { playEvents, type AnimApi } from './anim/eventPlayer.js';
import { OnlineClient, clearSeat, loadSeat, planConnect, saveSeat } from './online.js';
import { playOutcome, setSoundEnabled, soundEnabled } from './sfx.js';
import { ANIM } from './theme.js';

export type Mode = 'hotseat' | 'bot' | 'online';
export type Screen = 'menu' | 'lobby' | 'game';

export interface RenderPiece {
  id: string;
  type: PieceType;
  color: Color;
  sq: Square;
}

export interface LocalOptions {
  mode: 'hotseat' | 'bot';
  difficulty: Difficulty;
  botLevel: Difficulty;
  humanColor: Color;
  boardSize: number;
  seed?: number;
  overrides?: Partial<GameConfig>;
}

export interface OnlineInfo {
  code: string | null;
  connected: boolean;
  opponentConnected: boolean;
  waiting: boolean;
  /**
   * Momento en que el rival ausente pierde por abandono, o `null` si no corre plazo. Se
   * guarda como instante y no como cuenta atras para que el HUD pueda refrescarla sin que
   * el store tenga que latir cada segundo.
   */
  opponentDeadline: number | null;
  /** Has pedido la revancha y falta que la pida el rival. */
  rematchMine: boolean;
  /** El rival la pidio y falta que la pidas vos. */
  rematchTheirs: boolean;
}

interface AppState {
  screen: Screen;
  mode: Mode;
  difficulty: Difficulty;
  botLevel: Difficulty;
  humanColor: Color;
  boardSize: number;
  seed: number;
  overrides?: Partial<GameConfig>;

  /** Estado autoritativo. Solo existe en partidas locales; en online lo tiene el servidor. */
  engine: GameState | null;
  /** Lo unico que la interfaz dibuja, en todos los modos. */
  view: PlayerView | null;
  /** Banderas rojas del jugador: viven en el cliente, nadie mas las necesita. */
  flags: boolean[];
  online: OnlineInfo;

  // Capa de render: va por detras de `view` mientras corre una animacion.
  pieces: RenderPiece[];
  revealed: boolean[];
  detonated: boolean[];
  craters: boolean[];
  adjacency: number[];
  blasts: Square[];
  dying: string[];

  animating: boolean;
  selected: Square | null;
  targets: Square[];
  lastMove: { from: Square; to: Square } | null;
  orientation: Color;
  flipEachTurn: boolean;
  showBalance: boolean;
  soundOn: boolean;
  error: string | null;
  /** Salir de una partida online en curso la cede: se pregunta antes. */
  confirmingLeave: boolean;

  startLocal: (options: LocalOptions) => void;
  restart: (overrides?: Partial<GameConfig>, seed?: number) => void;
  hostOnline: (settings: RoomSettings) => void;
  joinOnline: (code: string) => void;
  resumeOnline: () => boolean;
  rematchOnline: () => void;
  askLeave: () => void;
  cancelLeave: () => void;
  backToMenu: () => void;
  clickSquare: (sq: Square) => void;
  rightClickSquare: (sq: Square) => void;
  submitMove: (move: Move) => void;
  flipBoard: () => void;
  setFlipEachTurn: (value: boolean) => void;
  setSoundOn: (value: boolean) => void;
  toggleBalancePanel: () => void;
}

const piecesOf = (view: PlayerView): RenderPiece[] => {
  const out: RenderPiece[] = [];
  view.board.forEach((piece, sq) => {
    if (piece !== null) out.push({ id: piece.id, type: piece.type, color: piece.color, sq });
  });
  return out;
};

/** Vuelca la vista en la capa de render. Se llama al terminar cada animacion. */
const renderLayer = (view: PlayerView) => ({
  pieces: piecesOf(view),
  revealed: view.revealed.slice(),
  detonated: view.detonated.slice(),
  craters: view.craters.slice(),
  adjacency: view.adjacency.slice(),
  blasts: [] as Square[],
  dying: [] as string[],
});

let socket: OnlineClient | null = null;

/**
 * Credencial guardada para la sala a la que se esta entrando, todavia sin usar. Se prueba
 * solo si el servidor rechaza la entrada normal: el sitio que falta puede ser el nuestro.
 */
let seatFallback: ConnectIntent | null = null;
/** Se esta probando esa credencial. Si tambien la rechazan, ya no vale. */
let tryingSeatFallback = false;

export const useGame = create<AppState>((set, get) => {
  const animApi = (config: GameConfig): AnimApi => ({
    config,
    orientation: () => get().orientation,
    setPieceSquare: (id, sq) =>
      set((s) => ({ pieces: s.pieces.map((p) => (p.id === id ? { ...p, sq } : p)) })),
    promote: (id, to) =>
      set((s) => ({ pieces: s.pieces.map((p) => (p.id === id ? { ...p, type: to } : p)) })),
    markDying: (id) => set((s) => ({ dying: [...s.dying, id] })),
    removePiece: (id) =>
      set((s) => ({
        pieces: s.pieces.filter((p) => p.id !== id),
        dying: s.dying.filter((d) => d !== id),
      })),
    setBlasts: (cells) => set({ blasts: cells }),
    burnCells: (cells, center) =>
      set((s) => {
        const detonated = s.detonated.slice();
        const revealed = s.revealed.slice();
        const craters = s.craters.slice();
        for (const cell of cells) {
          detonated[cell] = true;
          revealed[cell] = true;
        }
        craters[center] = true;
        return { detonated, revealed, craters };
      }),
    reveal: (cells) =>
      set((s) => {
        const revealed = s.revealed.slice();
        for (const cell of cells) revealed[cell] = true;
        return { revealed };
      }),
    gameEnd: (_status, winner) => {
      const s = get();
      // En hotseat no hay un "tu": suena victoria para quien haya ganado.
      if (winner === null) playOutcome('draw');
      else if (s.mode === 'hotseat') playOutcome('win');
      else playOutcome(winner === s.humanColor ? 'win' : 'loss');
    },
  });

  /** Reproduce la animacion y despues fija la vista definitiva. */
  const play = async (events: GameEvent[], view: PlayerView): Promise<void> => {
    set({ animating: true, selected: null, targets: [], error: null });
    await playEvents(events, animApi(view.config));
    const s = get();
    set({
      view,
      ...renderLayer(view),
      animating: false,
      orientation:
        s.mode === 'hotseat' && s.flipEachTurn && view.status === 'playing'
          ? view.turn
          : s.orientation,
    });
    runBot();
  };

  const runBot = (): void => {
    const s = get();
    if (s.mode !== 'bot' || s.animating) return;
    const view = s.view;
    if (view === null || view.status !== 'playing' || view.turn === s.humanColor) return;

    window.setTimeout(() => {
      const current = get();
      const engine = current.engine;
      if (engine === null || engine.status !== 'playing' || engine.turn === current.humanColor) return;
      const move = chooseMove(toView(engine, engine.turn), { level: current.botLevel });
      if (move) current.submitMove(move);
    }, ANIM.botThink);
  };

  const onServerMessage = (message: ServerMessage): void => {
    const s = get();
    switch (message.t) {
      case 'seated':
        seatFallback = null;
        tryingSeatFallback = false;
        saveSeat({ code: message.code, token: message.token });
        set({
          screen: 'game',
          mode: 'online',
          humanColor: message.color,
          orientation: message.color,
          view: message.view,
          engine: null,
          flags: new Array<boolean>(message.view.board.length).fill(false),
          ...renderLayer(message.view),
          animating: false,
          selected: null,
          targets: [],
          lastMove: null,
          error: null,
          // Empieza partida: las peticiones de revancha quedan saldadas.
          online: {
            ...s.online,
            code: message.code,
            connected: true,
            waiting: true,
            rematchMine: false,
            rematchTheirs: false,
          },
        });
        break;
      case 'sync':
        set({ view: message.view, ...renderLayer(message.view), animating: false });
        break;
      case 'moved': {
        const last = message.events.find((e) => e.type === 'hop');
        if (last && last.type === 'hop') {
          const hops = message.events.filter((e) => e.type === 'hop');
          const first = hops[0];
          const final = hops[hops.length - 1];
          if (first.type === 'hop' && final.type === 'hop') {
            set({ lastMove: { from: first.from, to: final.to } });
          }
        }
        void play(message.events, message.view);
        break;
      }
      case 'rematch':
        set({ online: { ...get().online, rematchMine: message.mine, rematchTheirs: message.theirs } });
        break;
      case 'opponent':
        set({
          online: {
            ...get().online,
            opponentConnected: message.connected,
            waiting: !message.connected,
            opponentDeadline: message.msLeft === undefined ? null : Date.now() + message.msLeft,
          },
        });
        break;
      case 'error': {
        // La sala rechaza, pero hay credencial guardada para ella: el sitio que falta puede
        // ser el nuestro. Se prueba antes de dar el rechazo por bueno.
        if (seatFallback !== null) {
          const fallback = seatFallback;
          seatFallback = null;
          tryingSeatFallback = true;
          socket?.connect(fallback);
          break;
        }
        // Ni como jugador nuevo ni con la credencial: esa credencial ya no sirve.
        if (tryingSeatFallback) {
          tryingSeatFallback = false;
          clearSeat();
        }
        set({ error: message.message });
        break;
      }
    }
  };

  const ensureSocket = (): OnlineClient => {
    if (socket === null) {
      socket = new OnlineClient({
        onMessage: onServerMessage,
        onOpen: () => set({ online: { ...get().online, connected: true } }),
        onClose: (willRetry, deliberate) => {
          const s = get();
          set({ online: { ...s.online, connected: false } });
          // Si el servidor explico el motivo ya hay un error puesto; si no lo hizo (origen
          // rechazado, parametros invalidos, servidor caido) el cliente se quedaria mirando
          // un "Conectando..." eterno.
          if (!willRetry && !deliberate && s.error === null) {
            set({ error: 'No se pudo conectar con el servidor.' });
          }
        },
      });
    }
    return socket;
  };

  return {
    screen: 'menu',
    mode: 'hotseat',
    difficulty: 'normal',
    botLevel: 'normal',
    humanColor: 'w',
    boardSize: 8,
    seed: 0,

    engine: null,
    view: null,
    flags: [],
    online: {
        code: null,
        connected: false,
        opponentConnected: false,
        waiting: false,
        opponentDeadline: null,
        rematchMine: false,
        rematchTheirs: false,
      },
    confirmingLeave: false,

    pieces: [],
    revealed: [],
    detonated: [],
    craters: [],
    adjacency: [],
    blasts: [],
    dying: [],

    animating: false,
    selected: null,
    targets: [],
    lastMove: null,
    orientation: 'w',
    flipEachTurn: true,
    showBalance: false,
    soundOn: soundEnabled(),
    error: null,

    startLocal: (options) => {
      socket?.close();
      socket = null;
      const seed = options.seed ?? randomSeed();
      const config = configFor(options.difficulty, {
        files: options.boardSize,
        ranks: options.boardSize,
        seed,
        ...options.overrides,
      });
      const engine = createGame(config);
      const orientation = options.mode === 'hotseat' ? 'w' : options.humanColor;
      const view = toView(engine, options.mode === 'hotseat' ? engine.turn : options.humanColor);

      set({
        ...options,
        seed,
        screen: 'game',
        engine,
        view,
        flags: new Array<boolean>(engine.board.length).fill(false),
        online: {
        code: null,
        connected: false,
        opponentConnected: false,
        waiting: false,
        opponentDeadline: null,
        rematchMine: false,
        rematchTheirs: false,
      },
        ...renderLayer(view),
        animating: false,
        selected: null,
        targets: [],
        lastMove: null,
        orientation,
        error: null,
      });
      runBot();
    },

    restart: (overrides, seed) => {
      const s = get();
      if (s.mode === 'online') return s.rematchOnline();
      s.startLocal({
        mode: s.mode === 'bot' ? 'bot' : 'hotseat',
        difficulty: s.difficulty,
        botLevel: s.botLevel,
        humanColor: s.humanColor,
        boardSize: overrides?.files ?? s.boardSize,
        seed: seed ?? randomSeed(),
        overrides: { ...s.overrides, ...overrides },
      });
    },

    // A que sala se entra viaja en la URL de la conexion, no como mensaje: es lo que
    // permite al servidor enrutar hacia la sala antes de aceptar el socket.
    hostOnline: (settings) => {
      set({ screen: 'lobby', mode: 'online', error: null });
      ensureSocket().connect({ a: 'create', ...settings });
    },

    joinOnline: (code) => {
      // Se valida aqui: un codigo mal formado no llega ni a WebSocket, asi que el servidor
      // no tendria por donde contestar y el usuario se quedaria esperando sin motivo.
      const clean = normalizeRoomCode(code);
      if (!isValidRoomCode(clean)) {
        set({ error: `"${clean}" no es un codigo de sala valido: son 6 caracteres.` });
        return;
      }
      set({ screen: 'lobby', mode: 'online', error: null });

      // Escribir el codigo de tu propia partida es lo que hace la gente para volver, y
      // responderle "la sala esta completa" es contarle que su propio asiento le bloquea la
      // entrada. Pero el orden importa: primero se pide sitio y solo despues se recurre a la
      // credencial. Ver `planConnect`.
      const plan = planConnect(clean, loadSeat());
      seatFallback = plan.fallback;
      tryingSeatFallback = false;
      ensureSocket().connect(plan.first);
    },

    resumeOnline: () => {
      const seat = loadSeat();
      if (seat === null) return false;
      set({ screen: 'lobby', mode: 'online', error: null });
      ensureSocket().connect({ a: 'resume', code: seat.code, token: seat.token });
      return true;
    },

    rematchOnline: () => socket?.send({ t: 'rematch' }),

    /**
     * Puerta unica del boton Menu. Solo hay algo que confirmar si irse tiene un coste:
     * una partida online en curso se cede al salir. En local o ya terminada, se sale.
     */
    askLeave: () => {
      const s = get();
      const live = s.mode === 'online' && s.view !== null && s.view.status === 'playing';
      if (!live) return s.backToMenu();
      set({ confirmingLeave: true });
    },

    cancelLeave: () => set({ confirmingLeave: false }),

    backToMenu: () => {
      if (get().mode === 'online') {
        socket?.send({ t: 'leave' });
        socket?.close();
        socket = null;
        clearSeat();
        seatFallback = null;
        tryingSeatFallback = false;
      }
      set({
        screen: 'menu',
        engine: null,
        view: null,
        selected: null,
        targets: [],
        online: {
        code: null,
        connected: false,
        opponentConnected: false,
        waiting: false,
        opponentDeadline: null,
        rematchMine: false,
        rematchTheirs: false,
      },
        confirmingLeave: false,
      });
    },

    flipBoard: () => set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' })),
    setFlipEachTurn: (value) => set({ flipEachTurn: value }),
    setSoundOn: (value) => {
      setSoundEnabled(value);
      set({ soundOn: value });
    },
    toggleBalancePanel: () => set((s) => ({ showBalance: !s.showBalance })),

    clickSquare: (sq) => {
      const s = get();
      const view = s.view;
      if (view === null || s.animating || view.status !== 'playing') return;
      if (s.mode !== 'hotseat' && view.turn !== s.humanColor) return;

      if (s.selected !== null && s.targets.includes(sq)) {
        s.submitMove({ from: s.selected, to: sq });
        return;
      }

      const piece = view.board[sq];
      if (piece === null || piece.color !== view.turn) {
        set({ selected: null, targets: [] });
        return;
      }
      // La legalidad no depende de las minas, asi que la vista basta para calcularla.
      const position = s.engine ?? hypotheticalState(view);
      const targets = legalMoves(position, view.turn)
        .filter((m) => m.from === sq)
        .map((m) => m.to);
      set({ selected: sq, targets: [...new Set(targets)] });
    },

    rightClickSquare: (sq) => {
      const s = get();
      if (s.view === null || s.animating) return;
      const flags = s.flags.slice();
      flags[sq] = !flags[sq];
      set({ flags });
    },

    submitMove: (move) => {
      const s = get();
      const view = s.view;
      if (view === null || s.animating || view.status !== 'playing') return;

      if (s.mode === 'online') {
        set({ selected: null, targets: [], error: null });
        socket?.send({ t: 'move', move });
        return;
      }

      const engine = s.engine;
      if (engine === null) return;
      let result;
      try {
        result = applyMove(engine, move);
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : String(err),
          selected: null,
          targets: [],
        });
        return;
      }

      const nextView = toView(
        result.state,
        s.mode === 'hotseat' ? result.state.turn : s.humanColor,
      );
      set({ engine: result.state, lastMove: { from: move.from, to: move.to } });
      void play(result.events, nextView);
    },
  };
});

/** Color desde cuyo punto de vista se juega ahora. */
export const viewerColor = (s: AppState): Color =>
  s.mode === 'hotseat' ? (s.view?.turn ?? 'w') : s.humanColor;
