import type { CardDef, Ctx, Piece, Sq } from './types'

/**
 * Интерпретатор EffectOp-DSL. Выполняет эффекты карты последовательно.
 * Валидация целей уже прошла в validate() — здесь только исполнение.
 */
export function executeEffects(ctx: Ctx, def: CardDef, targets: Sq[]): void {
  const t0 = targets[0] ?? -1
  const t1 = targets[1] ?? -1
  const active = ctx.state.active

  for (const fx of def.effects) {
    switch (fx.op) {
      case 'summon': {
        ctx.spawnPiece(active, fx.pieceType, t0, fx.traits)
        break
      }
      case 'damage': {
        const p = ctx.pieceAt(t0)
        if (p) ctx.dealDamage(p, fx.n)
        break
      }
      case 'destroy': {
        const p = ctx.pieceAt(t0)
        if (p) ctx.destroyPiece(p)
        break
      }
      case 'addTrait': {
        const p = ctx.pieceAt(t0)
        if (p) ctx.addTrait(p, fx.trait, fx.turns)
        break
      }
      case 'cutTile': {
        ctx.cutTile(t0)
        break
      }
      case 'glueTile': {
        ctx.glueTile(t0)
        break
      }
      case 'push': {
        const p = ctx.pieceAt(t0)
        if (p) ctx.pushPiece(p, t0, fx.dist)
        break
      }
      case 'gainPaint': {
        ctx.gainPaint(active, fx.n)
        break
      }
      case 'draw': {
        ctx.drawCards(active, fx.n)
        break
      }
      case 'swap': {
        const a = ctx.pieceAt(t0) as Piece | null
        const b = ctx.pieceAt(t1) as Piece | null
        if (a && b) ctx.swapPieces(a, b)
        break
      }
    }
  }
}
