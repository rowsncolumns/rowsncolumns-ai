import type { ImageLoaderProps } from "next/image";

export const passthroughImageLoader = ({ src }: ImageLoaderProps): string =>
  src;
