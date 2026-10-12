# token-speed

Indicadores de **velocidad de generación** (tk/s) y **ocupación de contexto** para la
interfaz de OpenCode. Se apoya en los slots públicos de la interfaz, no en los
indicadores nativos del host.

[MIT](LICENSE) · Instalable con `bun run setup` · Probado en OpenCode 1.19.0 con Bun.

## Qué muestra

| Indicador | Dónde | Cómo se calcula |
|---|---|---|
| `≈12,3 tk/s` | fila del prompt | Tokens de salida ÷ duración. **Final**: tokens que reporta el proveedor. **En vivo**: estimación BPE local del texto visible. |
| `Contexto [███████░] 93% · 185k/200k tk` | fila del prompt | Último reporte positivo del mensaje: `input + output + reasoning + cache.read + cache.write`, dividido por el límite del modelo. |
| `Context` + barra + coste | panel lateral | Mismo origen que la fila del prompt. |

## Qué **no** muestra, y por qué

- **No es el conteo del proveedor mientras escribe.** En vivo es una estimación BPE local
  (`o200k_base`, o `cl100k_base` para GPT-3.5/GPT-4 legacy). No se afirma equivalencia
  exacta con ningún modelo desconocido.
- **La media es del texto visible.** Excluye razonamiento y ejecución de herramientas. Si
  una herramienta interviene, la base pasa a ser la duración total y se rotula
  `≈X tk/s total`.
- **No hay contador junto a cada respuesta.** Los slots públicos de la interfaz V1 no lo
  permiten, y tampoco permiten ocultar por separado los contadores nativos de sus footers.
- **Si falta un solo componente del reporte** (`input`, `output`, `reasoning`,
  `cache.read`, `cache.write`), el total se declara desconocido y se muestra `—`. Es
  deliberado: no se estima un dato que el host no confirmó.

## Requisitos

| | |
|---|---|
| Host | OpenCode `>=1.19.0 <2`. Probado en `1.19.0`. |
| Runtime | [Bun](https://bun.sh) (instalación, pruebas y CLI). |
| Red | Sólo durante la instalación de `gpt-tokenizer`. |

Las dependencias del host —`@opentui/core`, `@opentui/solid`, `solid-js` y los tipos de
`@opencode-ai/plugin/tui`— **no se instalan**: viven dentro del binario de OpenCode. Por eso
el plugin está acoplado a la versión del host, no a este repositorio.

## Instalación

```sh
git clone <url-de-este-repo> "$(opencode debug paths | awk '$1=="config"{print $2}')/tui-plugins/token-speed"
cd "$(opencode debug paths | awk '$1=="config"{print $2}')/tui-plugins/token-speed"
bun run setup
```

`setup` es idempotente: se puede repetir sin efectos. Hace, en orden:

1. Localiza la configuración con `opencode debug paths` (no asume `~/.config`).
2. **Comprueba que este repositorio está donde el host buscará el plugin.** La entrada de
   `tui.json` es relativa a ese fichero; si clonas el repo en otro sitio, el host no lo
   encontrará aunque todo lo demás salga bien. Si no encaja, **no escribe nada**.
3. Comprueba la versión del host y **avisa** si está fuera del rango probado. No bloquea:
   un aviso no debe dejarte sin indicador tras cada actualización de OpenCode.
4. `bun install --frozen-lockfile --ignore-scripts`.
5. Registra la entrada en `tui.json` y desactiva `internal:sidebar-context`.

Si algo falla en los pasos 3 o 4, `setup` **no registra el plugin**: dejar la entrada puesta
sin sus dependencias deja al host con un módulo que no carga.

Al escribir `tui.json`: compara el contenido de forma semántica (no lo reformatea si es
equivalente), guarda `tui.json.bak` **sólo si no existía** —para que un `setup` seguido de
un `uninstall` no dejen como único original el estado generado por la herramienta—, escribe
en un temporal y renombra, y se niega a operar si `tui.json` o su `.bak` son enlaces
simbólicos.

Reinicia OpenCode después: la configuración no se recarga en caliente.

Simula el paso 5 sin escribir nada (sí ejecuta `bun install`):

```sh
bun run setup --dry-run
```

## Verificación

```sh
bun run verify
```

Comprueba, en orden: host disponible y en rango · `gpt-tokenizer` instalado · entrada
registrada **una sola vez** · indicador nativo desactivado · `tui.json` sin claves que el
esquema rechace · pruebas en verde. Termina con código de salida 1 si algo falla.

```sh
bun run verify --skip-tests   # solo el estado de la instalación
bun test                      # solo la batería
bun run typecheck             # solo los tipos
```

`verify` ejecuta el código de este repositorio (`bun test`). Instálalo sólo si confías en
él: es lo mismo que hacer `bun install` y `bun run` a mano.

## Conflictos conocidos

| Síntoma | Qué hace el instalador | Si persiste |
|---|---|---|
| `setup` dice «no está donde el host buscará» | No escribe nada y sale con error | Clona el repo en `<config>/tui-plugins/token-speed`. Es la única ubicación que resuelve la entrada relativa. |
| `Cannot find module 'gpt-tokenizer'` | `bun install --frozen-lockfile` | `node_modules/` nunca se copia entre equipos: se regenera. |
| Los indicadores no aparecen | Avisa si el host está fuera de rango | Los slots de la interfaz V1 pueden haber cambiado. Requiere adaptar `tui.tsx` al host nuevo. |
| **Aparecen los dos contadores de contexto** | Escribe `plugin_enabled["internal:sidebar-context"] = false` | `tui.tsx:148` lo desactiva en runtime, pero eso no persiste: sin el override, vuelve el nativo. |
| **No aparece ningún contador** tras desinstalar | `uninstall` retira el override y restituye el nativo | Revisa `tui.json`: un `plugin_enabled` huérfano deja al host sin nada que mostrar. |
| opencode no arranca | Avisa de las claves no admitidas por el esquema | `tui.json` tiene `additionalProperties: false`. Renombra o elimina la clave. La lista de claves válidas es una copia de `https://opencode.ai/tui.json` (**verificada el 2026-10-12**): si el host añadió claves nuevas, el aviso puede ser falso. |
| La entrada aparece duplicada | `setup` deduplica y deja una sola | No añadas el plugin a `opencode.json` además de a `tui.json`. |
| `opencode: command not found` | No bloquea: cae a `$XDG_CONFIG_HOME/opencode` o `$HOME/.config/opencode` | Instala OpenCode antes de verificar. |
| `Se niega a escribir … es un enlace simbólico` | No toca nada | `tui.json` o `tui.json.bak` son enlaces. Revísalos a mano: no es un caso que el instalador pueda resolver solo. |
| `<directorio> no existe como directorio` | No crea el árbol que falte | Arranca OpenCode una vez para que cree su configuración, y repite. |

## Desinstalación

```sh
bun run uninstall            # desregistra y restituye el indicador nativo
bun run uninstall --purge    # además borra node_modules
```

## Qué cubren las pruebas

`bun test` ejecuta **189 pruebas**:

- **Lógica pura** — conteo y codificación de referencia, selección de mensaje, cálculo de
  velocidad y sus estados, uso de contexto y formato, límites de la estimación en vivo, y
  ciclo de vida del temporizador de refresco.
- **Instalador** — fusión de `tui.json` (idempotencia, deduplicación, preservación de
  claves), resolución y validación de la ruta del host, escritura con copia de seguridad,
  rechazo de enlaces simbólicos y fallo ante directorio inexistente.
- **Las tres CLI** — con un `opencode` de mentira en el `PATH` y un `HOME` desechable:
  instalación en limpio, repetición sin tocar el fichero, escritura abortada si hay
  comprobaciones en rojo, ida y vuelta setup→uninstall que restituye el fichero original,
  y detección de entrada duplicada o de indicador nativo no desactivado.

**Lo que no cubren**, y es un límite declarado:

- **`tui.tsx` no tiene pruebas.** Importa `@opentui/solid` y `solid-js`, que sólo existen
  dentro del binario del host: no se pueden resolver fuera de él. Tampoco entra en
  `bun run typecheck` por el mismo motivo.
- **No hay prueba del arranque real del host.** `verify` comprueba el estado en disco y la
  batería, no que los slots se pinten. La comprobación visual es humana.

Por eso no hay aquí ninguna afirmación sobre un render verificado: lo que se afirma es lo
que `bun test` ejecuta en este repositorio.

## Ficheros

| | |
|---|---|
| `tui.tsx` | Render. Única pieza que depende del host. |
| `metrics.ts` `context.ts` `live.ts` `refresh.ts` `tokenizer.ts` | Lógica de los indicadores, sin host. |
| `config.ts` `entorno.ts` `disco.ts` `informe.ts` | Fusión de configuración, resolución de rutas, escritura e informe. |
| `setup.ts` `verify.ts` `uninstall.ts` | CLI de línea de comandos. |
| `*.test.ts` | Pruebas, una por módulo y una de humo de las CLI. |