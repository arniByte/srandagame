/** Тест-хуки игры (?test=1): общий тип для всех e2e-спеков. */
declare global {
  interface Window {
    __cm: {
      screen: string
      battle: {
        result: unknown
        turn: number
        active: number
        phase: string
        movedThisTurn: boolean
        promoting: { piece: number; options: string[] } | null
        pieces: { id: number; owner: number; pos: number }[]
        sides: { hand: number[]; paint: number }[]
      } | null
      run: { gold: number; roster: unknown[] } | null
      newRun(seed?: string): void
      availableNodes(): { id: string; kind: string }[]
      selectNode(id: string): void
      inputEnabled(): boolean
      legalMovesFor(id: number): number[]
      legalTargetsFor(iid: number): number[]
      tryAction(a: unknown): boolean
      debugTileXY(sq: number): { x: number; y: number } | null
      debugFirstCard(): { iid: number; x: number; y: number } | null
      getState(): {
        movedThisTurn: boolean
        phase: string
        promoting: { piece: number; options: string[] } | null
        board: { w: number; h: number }
        pieces: { id: number; owner: number; pos: number }[]
        sides: { hand: number[]; paint: number }[]
      }
    }
  }
}

export {}
