export function parseRoute() {
  const path = window.location.pathname;
  const [, route, code, extra] = path.split("/");
  if (route === "join") return { view: "participant", code: code?.toUpperCase() || "" };
  if (route === "host") return { view: "host", code: code?.toUpperCase() || "" };
  if (route === "register") return { view: "register", planKey: code || "starter" };
  if (route === "verify") return { view: "verify", token: code || extra || "" };
  if (route === "admin") return { view: "admin", organizationId: code || "" };
  if (route === "superadmin") return { view: "superadmin" };
  if (route === "features") return { view: "landing", section: code || extra || "features" };
  return { view: "landing" };
}

export function pathForView(nextRoute) {
  const pathByView = {
    landing: "/",
    register: `/register/${nextRoute.planKey || "starter"}`,
    admin: `/admin/${nextRoute.organizationId || ""}`,
    superadmin: "/superadmin",
    participant: `/join/${nextRoute.code || ""}`,
    host: `/host/${nextRoute.code || ""}`,
    verify: `/verify/${nextRoute.token || ""}`,
  };
  return pathByView[nextRoute.view] || "/";
}
