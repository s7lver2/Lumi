import type { MDXComponents } from "mdx/types";
import { EncabezadoDocs } from "./components/docs/EncabezadoDocs";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h2: (props) => <EncabezadoDocs nivel={2} {...props} />,
    h3: (props) => <EncabezadoDocs nivel={3} {...props} />,
  };
}
