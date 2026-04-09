import type { SeparatorDef, StatusLineSeparatorStyle } from "./types.js";
import { getSeparatorChars } from "./icons.js";

export function getSeparator(style: StatusLineSeparatorStyle): SeparatorDef {
  const c = getSeparatorChars();
  switch (style) {
    case "powerline":      return { left: c.powerlineLeft,     right: c.powerlineRight };
    case "powerline-thin": return { left: c.powerlineThinLeft, right: c.powerlineThinRight };
    case "slash":          return { left: ` ${c.slash} `,      right: ` ${c.slash} ` };
    case "pipe":           return { left: ` ${c.pipe} `,       right: ` ${c.pipe} ` };
    case "block":          return { left: c.block,             right: c.block };
    case "none":           return { left: c.space,             right: c.space };
    case "ascii":          return { left: c.asciiLeft,         right: c.asciiRight };
    case "dot":            return { left: c.dot,               right: c.dot };
    case "chevron":        return { left: "›",                 right: "‹" };
    case "star":           return { left: "✦",                 right: "✦" };
    default:               return getSeparator("powerline-thin");
  }
}
