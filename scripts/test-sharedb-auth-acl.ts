import assert from "node:assert/strict";

type MiddlewareFn = (
  context: Record<string, unknown>,
  callback: (error?: Error) => void,
) => void;

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const createBackendMock = () => {
  const middleware = new Map<string, MiddlewareFn[]>();
  const backend = {
    use(action: string, fn: MiddlewareFn) {
      const existing = middleware.get(action) ?? [];
      existing.push(fn);
      middleware.set(action, existing);
      return backend;
    },
  };
  return { backend, middleware };
};

const invokeMiddleware = async (
  fn: MiddlewareFn,
  context: Record<string, unknown>,
): Promise<Error | undefined> => {
  return new Promise((resolve) => {
    fn(context, (error?: Error) => resolve(error));
  });
};

const createAuthState = (input?: {
  userId?: string;
  failureReason?: "no_cookie" | "invalid_token" | "timeout" | "endpoint_failure" | null;
  statusCode?: number;
}) => ({
  identity: input?.userId
    ? {
        userId: input.userId,
        email: null,
        name: null,
      }
    : null,
  failureReason: input?.failureReason ?? null,
  statusCode: input?.statusCode,
  resolvedAt: Date.now(),
});

const setDocAccess = (
  custom: Record<string, unknown>,
  docId: string,
  access: {
    canAccess: boolean;
    permission: "view" | "edit";
  },
) => {
  custom.__docAccessCache = {
    ...(custom.__docAccessCache as Record<string, unknown> | undefined),
    [docId]: {
      ...access,
      expiresAt: Date.now() + 60_000,
    },
  };
};

const getErrorCode = (error: Error | undefined): string | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : null;
};

async function main() {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  const { registerAuthAccessMiddleware } = await import("../server");

  const { backend, middleware } = createBackendMock();
  registerAuthAccessMiddleware(backend as never);

  const readSnapshots = middleware.get("readSnapshots")?.[0];
  const submit = middleware.get("submit")?.[0];
  if (!readSnapshots || !submit) {
    throw new Error("Expected ShareDB auth/access middleware to be registered.");
  }

  const tests: TestCase[] = [
    {
      name: "unauthenticated fetch/subscribe is rejected with unauthorized",
      run: async () => {
        const rejected: Error[] = [];
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ failureReason: "no_cookie" }),
        };
        const error = await invokeMiddleware(readSnapshots, {
          collection: "spreadsheets",
          snapshots: [{ id: "doc_unauth" }],
          agent: { custom },
          rejectSnapshotRead: (_snapshot: unknown, err: Error) => rejected.push(err),
        });

        assert.equal(error, undefined);
        assert.equal(rejected.length, 1);
        assert.equal(getErrorCode(rejected[0]), "ERR_UNAUTHORIZED");
      },
    },
    {
      name: "authenticated user without doc access is rejected on read",
      run: async () => {
        const rejected: Error[] = [];
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "user_no_access" }),
        };
        setDocAccess(custom, "doc_forbidden", {
          canAccess: false,
          permission: "view",
        });

        const error = await invokeMiddleware(readSnapshots, {
          collection: "spreadsheets",
          snapshots: [{ id: "doc_forbidden" }],
          agent: { custom },
          rejectSnapshotRead: (_snapshot: unknown, err: Error) => rejected.push(err),
        });

        assert.equal(error, undefined);
        assert.equal(rejected.length, 1);
        assert.equal(getErrorCode(rejected[0]), "ERR_FORBIDDEN");
      },
    },
    {
      name: "authenticated view-only user cannot submit ops",
      run: async () => {
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "user_view_only" }),
        };
        setDocAccess(custom, "doc_view_only", {
          canAccess: true,
          permission: "view",
        });

        const error = await invokeMiddleware(submit, {
          collection: "spreadsheets",
          id: "doc_view_only",
          agent: { custom },
        });

        assert.ok(error);
        assert.equal(getErrorCode(error), "ERR_FORBIDDEN");
        assert.match(error.message, /permission to edit/i);
      },
    },
    {
      name: "authenticated edit user can submit ops",
      run: async () => {
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "user_editor" }),
        };
        setDocAccess(custom, "doc_editor", {
          canAccess: true,
          permission: "edit",
        });

        const error = await invokeMiddleware(submit, {
          collection: "spreadsheets",
          id: "doc_editor",
          agent: { custom },
        });

        assert.equal(error, undefined);
      },
    },
    {
      name: "owner access allows submit",
      run: async () => {
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "owner_user" }),
        };
        setDocAccess(custom, "doc_owner", {
          canAccess: true,
          permission: "edit",
        });

        const error = await invokeMiddleware(submit, {
          collection: "spreadsheets",
          id: "doc_owner",
          agent: { custom },
        });
        assert.equal(error, undefined);
      },
    },
    {
      name: "share-grant user can fetch/subscribe when read access exists",
      run: async () => {
        const rejected: Error[] = [];
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "share_user" }),
        };
        setDocAccess(custom, "doc_shared", {
          canAccess: true,
          permission: "view",
        });

        const error = await invokeMiddleware(readSnapshots, {
          collection: "spreadsheets",
          snapshots: [{ id: "doc_shared" }],
          agent: { custom },
          rejectSnapshotRead: (_snapshot: unknown, err: Error) => rejected.push(err),
        });

        assert.equal(error, undefined);
        assert.equal(rejected.length, 0);
      },
    },
    {
      name: "authenticated edit path supports fetch + submit (regression)",
      run: async () => {
        const rejected: Error[] = [];
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ userId: "regression_editor" }),
        };
        setDocAccess(custom, "doc_regression", {
          canAccess: true,
          permission: "edit",
        });

        const readError = await invokeMiddleware(readSnapshots, {
          collection: "spreadsheets",
          snapshots: [{ id: "doc_regression" }],
          agent: { custom },
          rejectSnapshotRead: (_snapshot: unknown, err: Error) => rejected.push(err),
        });
        const submitError = await invokeMiddleware(submit, {
          collection: "spreadsheets",
          id: "doc_regression",
          agent: { custom },
        });

        assert.equal(readError, undefined);
        assert.equal(submitError, undefined);
        assert.equal(rejected.length, 0);
      },
    },
    {
      name: "denied submit logs reason + doc id for observability",
      run: async () => {
        const custom: Record<string, unknown> = {
          __authState: createAuthState({ failureReason: "no_cookie" }),
        };
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
          warnings.push(args);
        };
        try {
          const error = await invokeMiddleware(submit, {
            collection: "spreadsheets",
            id: "doc_observe",
            agent: { custom },
          });
          assert.ok(error);
          assert.equal(getErrorCode(error), "ERR_UNAUTHORIZED");
        } finally {
          console.warn = originalWarn;
        }

        const matched = warnings.find(
          (args) =>
            args[0] === "[sharedb-auth]" &&
            args[1] === "submit_denied" &&
            typeof args[2] === "object" &&
            args[2] !== null &&
            (args[2] as { reason?: unknown }).reason === "no_cookie" &&
            (args[2] as { docId?: unknown }).docId === "doc_observe",
        );
        assert.ok(matched, "Expected submit_denied warning with reason and docId");
      },
    },
  ];

  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`PASS: ${test.name}`);
    } catch (error) {
      console.error(`FAIL: ${test.name}`);
      throw error;
    }
  }

  console.log(`\n${passed}/${tests.length} ShareDB auth/ACL tests passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
