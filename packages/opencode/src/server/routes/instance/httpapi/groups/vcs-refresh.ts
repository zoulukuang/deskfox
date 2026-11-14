import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { validVcsRefreshPaths } from "@/project/vcs-refresh-required"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

export const VcsRefreshPaths = { required: "/deskfox/vcs/refresh-required" } as const
export const VcsRefreshApi = HttpApi.make("vcsRefresh").add(
  HttpApiGroup.make("vcsRefresh")
    .add(
      HttpApiEndpoint.post("required", VcsRefreshPaths.required, {
        query: WorkspaceRoutingQuery,
        payload: Schema.Struct({ paths: Schema.Array(Schema.String).check(Schema.makeFilter(validVcsRefreshPaths)) }),
        success: Schema.Struct({ shouldRefresh: Schema.Boolean }),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "vcsRefresh.required",
          summary: "Check whether file events require a VCS refresh",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
