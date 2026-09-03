/**
 * Guarda de la version del protocolo.
 *
 * AC-503 hace que el servidor rechace a un cliente de otra version, pero eso solo sirve si la
 * version se sube cuando cambian los mensajes, y "acordarse" no es un mecanismo. Este test
 * calcula una huella de lo que viaja por el cable y la compara con la que quedo registrada
 * para la version actual: cambiar la forma sin subir la version rompe la suite.
 *
 * La huella sale del codigo y no de una lista escrita a mano. Se parte de los tres tipos raiz
 * y se sigue cada referencia que aparezca dentro, de modo que un tipo nuevo entra solo. Una
 * lista a mano seria la misma promesa un nivel mas abajo.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@cm/engine';
import history from './protocol.history.json' with { type: 'json' };

/** Lo que define el cable: los mensajes y como se pide entrar a una sala. */
const ROOTS = ['ClientMessage', 'ServerMessage', 'ConnectIntent'];

/** Ficheros donde viven esas declaraciones y todo lo que arrastran. */
const SOURCES = ['../src/protocol.ts', '../src/types.ts'];

type Declaration = ts.TypeAliasDeclaration | ts.InterfaceDeclaration;

/** Todas las declaraciones de tipo de esos ficheros, por nombre. */
function declarationsByName(): Map<string, Declaration> {
  const found = new Map<string, Declaration>();
  for (const relative of SOURCES) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
    );
    for (const statement of source.statements) {
      if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
        found.set(statement.name.text, statement);
      }
    }
  }
  return found;
}

/** Nombres de tipo referenciados dentro de una declaracion. */
function referencesIn(node: ts.Node): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName)) {
      names.push(child.typeName.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/**
 * Texto de la declaracion sin comentarios ni espacios de mas: reformatear o documentar no
 * cambia lo que viaja por el cable, y no deberia obligar a subir la version.
 */
function normalize(declaration: Declaration): string {
  return declaration
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cierre transitivo desde las raices, en orden estable para que la huella sea reproducible. */
function wireFingerprint(): { fingerprint: string; types: string[] } {
  const declarations = declarationsByName();
  const reached = new Set<string>();

  const walk = (name: string): void => {
    const declaration = declarations.get(name);
    // Un nombre que no esta declarado en estos ficheros no es parte del cable: `Partial`,
    // `Record` y los tipos del propio TypeScript caen aqui.
    if (declaration === undefined || reached.has(name)) return;
    reached.add(name);
    for (const referenced of referencesIn(declaration)) walk(referenced);
  };
  for (const root of ROOTS) walk(root);

  const types = [...reached].sort();
  const text = types.map((name) => normalize(declarations.get(name)!)).join('\n');
  return { fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 16), types };
}

describe('FR-5 parametros de conexion', () => {
  it('AC-504: las raices del cable se encuentran y arrastran lo que referencian', () => {
    const { types } = wireFingerprint();

    // Si esto falla, el recorrido dejo de encontrar los tipos y la huella no vigila nada.
    for (const root of ROOTS) expect(types).toContain(root);
    // Arrastrados: no se nombran en ROOTS, entran porque los mensajes los referencian.
    expect(types).toContain('PlayerView');
    expect(types).toContain('GameEvent');
    expect(types).toContain('EndReason');
  });

  it('AC-504: la forma del cable coincide con la registrada para esta version', () => {
    const { fingerprint } = wireFingerprint();
    const registered = (history as Record<string, string>)[String(PROTOCOL_VERSION)];

    expect(
      registered,
      `No hay huella registrada para la version ${PROTOCOL_VERSION}. ` +
        `Anade "${PROTOCOL_VERSION}": "${fingerprint}" a protocol.history.json.`,
    ).toBeDefined();

    expect(
      fingerprint,
      'Cambiaron los mensajes que viajan por el cable. Sube PROTOCOL_VERSION y anade su ' +
        `huella nueva ("${fingerprint}") a protocol.history.json. Pisar la de una version ` +
        'ya publicada dejaria entrar a clientes que hablan otro idioma.',
    ).toBe(registered);
  });
});
