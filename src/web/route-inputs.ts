import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router";

const resourceKeys: Record<string, string[]> = {
  "/assistant": ["flow", "thread", "items", "handoff"],
  "/development-tasks/new": ["remote", "items", "models"],
  "/work-items/sprints": ["sprint"],
  "/workspaces": ["edit"],
};

export function resourceRoute(base: string, values: Record<string, string>) {
  const params = new URLSearchParams(values);
  let path = base;
  for (const key of resourceKeys[base] || []) {
    const value = params.get(key);
    params.delete(key);
    if (value) path += `/${key}/${encodeURIComponent(value)}`;
  }
  const query = params.toString();
  return path + (query ? `?${query}` : "");
}

// Old shared links remain readable; all new navigation uses path segments.
export function useRouteInputs(base: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const prefix = /^\/workspace\/[^/]+/.exec(location.pathname)?.[0] || "";
  const params = useMemo(() => {
    const result = new URLSearchParams(location.search);
    const path = location.pathname.slice(prefix.length);
    const suffix = path.startsWith(base + "/")
      ? path.slice(base.length + 1).split("/")
      : [];
    for (let i = 0; i + 1 < suffix.length; i += 2) {
      if (resourceKeys[base]?.includes(suffix[i]!))
        result.set(suffix[i]!, decodeURIComponent(suffix[i + 1]!));
    }
    return result;
  }, [base, location.pathname, location.search, prefix]);
  const setParams = useCallback(
    (
      values: Record<string, string> | URLSearchParams,
      options?: NavigateOptions,
    ) => {
      const entries =
        values instanceof URLSearchParams ? Object.fromEntries(values) : values;
      navigate(prefix + resourceRoute(base, entries), options);
    },
    [base, navigate, prefix],
  );
  return [params, setParams] as const;
}
