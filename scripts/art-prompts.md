# CHECKMATISSE — стайл-байбл генерации арта (Higgsfield)

## Палитра (закреплена, передаётся в `colors`)

| Цвет | HEX | Роль |
|---|---|---|
| Киноварь | `#D93829` | фракция игрока (vermilion), акценты |
| Чёрный | `#1D1D1B` | фракция врага (ink), силуэты |
| Охра | `#F2A20C` | золото, королевские отметины |
| Синий | `#2E6CB5` | вторичный врага, вода/лёд |
| Зелёный | `#2C8C57` | природа, лоза |
| Кремовая бумага | `#F5EFE0` | фон/бумага (background_color) |
| Тёмный фон | `#14120F` | ночь, глубина сцены |

## Базовый префикс промпта (фигуры и предметы) — Recraft V4.1

> Matisse paper cut-out collage in Malevich suprematist style. Flat hard-edged
> torn painted paper shapes, gouache and oil paint texture on paper, visible
> brush strokes inside flat shapes, naive folk art geometry, bold poster
> silhouette, single centered object, plain cream paper background,
> no text, no gradients, no outlines.

Параметры: `model_type: "standard"`, `colors: [палитра]`, `background_color: "#F5EFE0"`,
`aspect_ratio: "1:1"` (фигуры) / `"3:4"` (иллюстрации карт).
Стоимость: 1.25 кредита/изображение. Всегда preflight `get_cost:true` перед пачкой.

## Базовый префикс (иллюстрации карт) — Nano Banana Pro

> Oil painting in the style of Matisse cut-outs and Russian suprematism,
> stop-motion puppet theater diorama feel, flat layered paper shapes with
> torn edges, thick oil paint texture, dramatic simple composition,
> palette: vermilion red, black, ochre yellow, cobalt blue, cream paper.

## Пайплайн

1. `generate_image` (Recraft для фигур/иконок, NBP для карт/фонов).
2. `remove_background` → PNG с прозрачностью (для фигур).
3. Скачать → `public/assets/{pieces,cards,bg,ui}/…`.
4. Заполнить `public/assets/manifest.json`: `{ src, pivot: [0.5, ~0.85], worldScale }`.
5. В игре ассеты «склеиваются» глобальной multiply-текстурой масла и едиными тенями.

## Реестр ключей ассетов

- `piece.{vermilion|ink}.{pawn|knight|bishop|rook|queen|king|gate|dove|dancer|square|vine}`
- `card.illus.{cardId}`, `card.frame.{common|uncommon|rare}`
- `bg.{sky|sun|hills1|hills2|castle|fore}` — слои диорамы
- `ui.{paintDrop|goldCoin|nodeIcons…}`
- `sfx.{move|capture|card|cut|glue|win|lose}`, `music.act1`
