function splitCombinedSetCookieHeader(setCookieHeader: string): string[] {
  const parts: string[] = [];
  let segmentStart = 0;

  for (let index = 0; index < setCookieHeader.length; index += 1) {
    if (setCookieHeader[index] !== ",") {
      continue;
    }

    const potentialCookie = setCookieHeader.slice(index + 1);
    const nextCookieStartsHere = /^\s*[-!#$%&'*+.^_`|~0-9A-Za-z]+=/.test(
      potentialCookie,
    );

    if (!nextCookieStartsHere) {
      continue;
    }

    const segment = setCookieHeader.slice(segmentStart, index).trim();
    if (segment.length > 0) {
      parts.push(segment);
    }
    segmentStart = index + 1;
  }

  const lastSegment = setCookieHeader.slice(segmentStart).trim();
  if (lastSegment.length > 0) {
    parts.push(lastSegment);
  }

  return parts;
}

export function readSetCookieHeaders(headers: Headers): string[] {
  const headerWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headerWithGetSetCookie.getSetCookie === "function") {
    return headerWithGetSetCookie.getSetCookie();
  }

  const setCookie = headers.get("set-cookie");
  if (!setCookie) {
    return [];
  }
  return splitCombinedSetCookieHeader(setCookie);
}

export function copySetCookieHeaders(source: Headers, target: Headers): void {
  const setCookies = readSetCookieHeaders(source);
  for (const setCookie of setCookies) {
    target.append("set-cookie", setCookie);
  }
}
