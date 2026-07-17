# AtomOS game and website platform

AtomOS can now model multi-screen websites and simple games with declarative, validated primitives.

## Components

- `board` for clickable grids and turn-based game boards
- `image` and `link` for website content and navigation
- `group` for row, column, grid and stack layouts
- `repeat` for galleries, inventories, shops, cards, menus and scoreboards

## State-driven UI

Components support `visibleWhen`, `hiddenWhen`, `enabledWhen` and `disabledWhen`.

## Navigation

Applications can declare `screens`, an `activeScreen` state key and `navigate` actions. Components may be assigned to a screen; components without a screen are shared across the app.

## Indexed actions

`list_set` and `list_remove` accept `indexFrom`, allowing board cells and repeated items to write their selected index into state before a rule runs.

This is intended for small multi-page sites, quizzes, board games, memory games, inventories, galleries and similar applications. Real-time physics, sprites, collision, audio and networking remain future capabilities.
