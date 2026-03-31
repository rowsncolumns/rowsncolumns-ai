type Json0Component = Record<string, unknown> & {
  p?: unknown[];
  lm?: unknown;
  na?: unknown;
  si?: unknown;
  sd?: unknown;
  oi?: unknown;
  od?: unknown;
  li?: unknown;
  ld?: unknown;
  t?: unknown;
  o?: unknown;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const clonePath = (path: unknown[] | undefined): unknown[] | undefined => {
  if (!Array.isArray(path)) {
    return undefined;
  }
  return [...path];
};

/**
 * Generate inverse json0 operations.
 *
 * Returns null when any component cannot be safely inverted.
 */
export function generateInverseRawOp(
  op: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> | null {
  const inverse: Array<Record<string, unknown>> = [];

  for (const rawComponent of [...op].reverse()) {
    const component = rawComponent as Json0Component;
    const path = clonePath(component.p);
    const next: Record<string, unknown> = {};

    if (path) {
      next.p = path;
    }

    let hasKnownMutation = false;

    const hasOi = "oi" in component;
    const hasOd = "od" in component;
    if (hasOi && hasOd) {
      next.oi = component.od;
      next.od = component.oi;
      hasKnownMutation = true;
    } else if (hasOi) {
      next.od = component.oi;
      hasKnownMutation = true;
    } else if (hasOd) {
      next.oi = component.od;
      hasKnownMutation = true;
    }

    const hasLi = "li" in component;
    const hasLd = "ld" in component;
    if (hasLi && hasLd) {
      next.li = component.ld;
      next.ld = component.li;
      hasKnownMutation = true;
    } else if (hasLi) {
      next.ld = component.li;
      hasKnownMutation = true;
    } else if (hasLd) {
      next.li = component.ld;
      hasKnownMutation = true;
    }

    if ("si" in component) {
      next.sd = component.si;
      hasKnownMutation = true;
    }

    if ("sd" in component) {
      next.si = component.sd;
      hasKnownMutation = true;
    }

    if ("na" in component) {
      const value = toNumber(component.na);
      if (value === null) {
        return null;
      }
      next.na = -value;
      hasKnownMutation = true;
    }

    // List move: move from original destination index back to source index.
    if ("lm" in component) {
      if (!Array.isArray(path) || path.length === 0) {
        return null;
      }
      const fromIndex = toNumber(path[path.length - 1]);
      const toIndex = toNumber(component.lm);
      if (fromIndex === null || toIndex === null) {
        return null;
      }
      const movedPath = [...path];
      movedPath[movedPath.length - 1] = toIndex;
      next.p = movedPath;
      next.lm = fromIndex;
      hasKnownMutation = true;
    }

    // Subtype operations require type-specific inversion support.
    if ("t" in component || "o" in component) {
      return null;
    }

    if (!hasKnownMutation) {
      return null;
    }

    inverse.push(next);
  }

  return inverse;
}

