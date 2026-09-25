/**
 * dsh-web-search-pool 的浏览器端 client half（DSH 0.1.7+）。
 *
 * 在「设置 → 插件」里 dsh-web-search-pool 的 Bundle 页 → `web-search-pool` 行的配置页
 * 注册「搜索 Key 池」表单：读 `web-search-pool` settings namespace 展示并编辑 key 池配置
 * （开关 / 策略 / 优先级 / 熔断 / key 增删 / 备注 / 限流）。每个 key 的密钥与 harness 其他
 * 密钥输入一致：write-only password，不显示明文，只显示「已配置/未配置」；留空保持当前密钥，
 * 输入新值并保存则覆盖。
 *
 * 0.1.7 适配（2026-09-25，依据桌面版 0.1.7-rc.2 源码与官方
 * `@deepseek-ai/dsh-client-ui-settings-web-search` 同构写法）：
 * - 插件配置入口从 **`settings.plugin.item` keyed slot**（rc.7/0.1.2）改为
 *   **`plugins.row.config` keyed slot**，key = `<bundle 包名>#<行 id>` =
 *   `dsh-web-search-pool#web-search-pool`（插件的 bundle patch 声明的行）。
 * - 数据面从旧版 settings scope 服务（0.1.2 移除，0.2.1 的 client half 还在 inject
 *   里等它，导致浏览器端 entry 永远 pending、web boot 失败）改为
 *   **`ctx.configForms`**（`@deepseek-ai/dsh-client-ui-settings` 提供）：
 *   `configForms.get(ns)` 返回带 `getSnapshot/subscribe/mutate` 的 form，
 *   `configForms.whileServed([ns], cb)` 在 Host 服务该 namespace 期间保持注册。
 * - 凭据读写走 Typert Remote（`ctx.remote.credentials` describe/set），
 *   设置写入走 `form.mutate(ops, expectedRevision)`（0.1.7 的 settings 事务入口）。
 * - 运行时会话数据（额度快照/刷新 tick）不再进 settings：0.1.7 的 settings 写入
 *   会持久化进 profile 的 cordis.patch.yml，Host 只做进程内刷新并记日志。
 *
 * 跨包协作全部走 cordis 服务与平台 seed（`react`），不 import 其它插件的值
 * （client bundle 纯度门禁的要求）。
 */

window.__ModuleLoader__.load({
  id: "dsh-web-search-pool",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var CSS = ".sp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.sp-card:hover{border-color:var(--dsw-alias-label-dimmed)}.sp-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.sp-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.sp-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.sp-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.sp-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.sp-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.sp-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.sp-chevronOpen{transform:rotate(180deg)}.sp-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.sp-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.sp-field+.sp-field{border-top:1px solid var(--dsw-alias-border-l2)}.sp-head{align-items:center;gap:8px;display:flex}.sp-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.sp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.sp-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.sp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.sp-input,.sp-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;width:100%;box-sizing:border-box}.sp-input:focus,.sp-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.sp-input:disabled,.sp-select:disabled{opacity:.6;cursor:not-allowed}.sp-keyBlock{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;margin-top:8px;overflow:hidden}.sp-keySummary{align-items:center;gap:8px;padding:8px 10px;display:flex;cursor:pointer}.sp-keySummary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.sp-keyName{color:var(--dsw-alias-label-primary);flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sp-keyDetails{flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2);padding:10px;display:flex}.sp-keyRow{align-items:center;gap:8px;display:flex}.sp-metricRow{align-items:center;gap:8px;display:flex}.sp-fieldLabel{color:var(--dsw-alias-label-secondary);min-width:64px;font-size:12px}.sp-metricInput{max-width:120px}.sp-secretRow{flex-direction:column;gap:6px;display:flex}.sp-secretHead{align-items:center;gap:8px;display:flex}.sp-secretInput{max-width:none}.sp-switchRow{align-items:center;gap:8px;display:flex}.sp-switchLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.sp-footer{align-items:center;gap:8px;padding:12px 0;display:flex}.sp-add,.sp-save,.sp-discard,.sp-remove{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;height:30px;font:inherit;font-size:12px;cursor:pointer;padding:0 12px}.sp-add:hover,.sp-save:hover,.sp-discard:hover,.sp-remove:hover{border-color:var(--dsw-alias-label-dimmed)}.sp-save{background:var(--dsw-alias-bg-module-platform);font-weight:500}.sp-save:disabled,.sp-add:disabled,.sp-remove:disabled{opacity:.5;cursor:not-allowed}.sp-error{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.sp-remove{margin-left:auto}";

    var CSS_TAG = "dsh-web-search-pool/client-card.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-web-search-pool";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** settings namespace = 插件的 loader 行 id（0.1.7 设置表单的 key）。 */
    var SETTINGS_NS = "web-search-pool";
    /** `plugins.row.config` keyed slot 的 key：`<bundle 包名>#<行 id>`。 */
    var ROW_CONFIG_KEY = "dsh-web-search-pool#" + SETTINGS_NS;

    var NUMERIC_DEFAULTS = {
      allowedFails: 3,
      cooldownMs: 30000,
      retryAfterFallbackMs: 1000,
      usageCacheMs: 300000,
      quotaReserveCredits: 2,
      quotaExhaustedCooldownMs: 2592000000,
      requestTimeoutMs: 20000
    };

    function toNumber(text, fallback) {
      var value = Number(String(text == null ? "" : text).trim());
      return Number.isFinite(value) ? value : fallback;
    }

    function isValidEnvName(name) {
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
    }

    function collectRefs(config) {
      var refs = [];
      if (config && config.providers) {
        if (config.providers.tavily && Array.isArray(config.providers.tavily.keys)) {
          config.providers.tavily.keys.forEach(function (k) { if (k.apiKeyEnv) refs.push(k.apiKeyEnv); });
        }
        if (config.providers.exa && Array.isArray(config.providers.exa.keys)) {
          config.providers.exa.keys.forEach(function (k) { if (k.apiKeyEnv) refs.push(k.apiKeyEnv); });
        }
      }
      return refs;
    }

    function editableCopy(config) {
      return {
        enabled: !(config && config.enabled === false),
        strategy: config && config.strategy ? config.strategy : "weighted-round-robin",
        providerPriority: config && Array.isArray(config.providerPriority) && config.providerPriority.length > 0
          ? config.providerPriority.slice()
          : ["tavily", "exa"],
        allowedFails: String(config && config.allowedFails != null ? config.allowedFails : NUMERIC_DEFAULTS.allowedFails),
        cooldownMs: String(config && config.cooldownMs != null ? config.cooldownMs : NUMERIC_DEFAULTS.cooldownMs),
        retryAfterFallbackMs: String(config && config.retryAfterFallbackMs != null ? config.retryAfterFallbackMs : NUMERIC_DEFAULTS.retryAfterFallbackMs),
        usageCacheMs: String(config && config.usageCacheMs != null ? config.usageCacheMs : NUMERIC_DEFAULTS.usageCacheMs),
        quotaReserveCredits: String(config && config.quotaReserveCredits != null ? config.quotaReserveCredits : NUMERIC_DEFAULTS.quotaReserveCredits),
        quotaExhaustedHours: String((config && config.quotaExhaustedCooldownMs != null ? config.quotaExhaustedCooldownMs : NUMERIC_DEFAULTS.quotaExhaustedCooldownMs) / 3600000),
        requestTimeoutMs: String(config && config.requestTimeoutMs != null ? config.requestTimeoutMs : NUMERIC_DEFAULTS.requestTimeoutMs),
        tavilyKeys: (config && config.providers && config.providers.tavily && Array.isArray(config.providers.tavily.keys) ? config.providers.tavily.keys : []).map(function (k, index) {
          return { _uid: "t" + index, apiKeyEnv: k.apiKeyEnv || "", rpm: String(k.rpm != null ? k.rpm : 60), remark: k.remark || "" };
        }),
        exaKeys: (config && config.providers && config.providers.exa && Array.isArray(config.providers.exa.keys) ? config.providers.exa.keys : []).map(function (k, index) {
          return { _uid: "e" + index, apiKeyEnv: k.apiKeyEnv || "", rpm: String(k.rpm != null ? k.rpm : 60), remark: k.remark || "" };
        })
      };
    }

    function keyEntries(list) {
      return list.map(function (k) {
        var entry = { apiKeyEnv: String(k.apiKeyEnv || "").trim(), rpm: toNumber(k.rpm, 60) };
        if (k.remark && String(k.remark).length > 0) entry.remark = String(k.remark);
        return entry;
      });
    }

    function sameKeys(a, b) {
      return JSON.stringify(keyEntries(a)) === JSON.stringify(keyEntries(b || []));
    }

    /**
     * 收集本次保存要写入的 ops（只写变化的字段，保持 profile patch 最小）。
     * 0.1.7 的设置写入是 profile patch 事务：路径必须落在 volatile 字段下
     * （本插件 Config 的全部顶层字段都已 volatile）。
     */
    function buildOps(draft, config) {
      var ops = [];
      function set(path, value) { ops.push({ op: "set", path: path, value: value }); }
      var current = config || {};
      var currentProviders = current.providers || {};
      var currentTavily = currentProviders.tavily || {};
      var currentExa = currentProviders.exa || {};

      if (draft.enabled !== (current.enabled !== false)) set(["enabled"], draft.enabled);
      if (draft.strategy !== (current.strategy || "weighted-round-robin")) set(["strategy"], draft.strategy);
      var currentPriority = Array.isArray(current.providerPriority) && current.providerPriority.length > 0 ? current.providerPriority : ["tavily", "exa"];
      if (draft.providerPriority.join(",") !== currentPriority.join(",")) set(["providerPriority"], draft.providerPriority);
      ["allowedFails", "cooldownMs", "retryAfterFallbackMs", "usageCacheMs", "quotaReserveCredits", "requestTimeoutMs"].forEach(function (field) {
        var next = toNumber(draft[field], NUMERIC_DEFAULTS[field]);
        var prev = current[field] != null ? current[field] : NUMERIC_DEFAULTS[field];
        if (next !== prev) set([field], next);
      });
      var nextExhausted = Math.round(toNumber(draft.quotaExhaustedHours, NUMERIC_DEFAULTS.quotaExhaustedCooldownMs / 3600000) * 3600000);
      var prevExhausted = current.quotaExhaustedCooldownMs != null ? current.quotaExhaustedCooldownMs : NUMERIC_DEFAULTS.quotaExhaustedCooldownMs;
      if (nextExhausted !== prevExhausted) set(["quotaExhaustedCooldownMs"], nextExhausted);
      if (!sameKeys(draft.tavilyKeys, currentTavily.keys)) set(["providers", "tavily", "keys"], keyEntries(draft.tavilyKeys));
      if (!sameKeys(draft.exaKeys, currentExa.keys)) set(["providers", "exa", "keys"], keyEntries(draft.exaKeys));
      return ops;
    }

    /** Typert Remote 信封 → 可读错误文本。 */
    function remoteFailureMessage(result) {
      var error = result && result.error;
      if (error == null) return "远程调用失败";
      return String(error.message || error.code || JSON.stringify(error));
    }

    /**
     * 0.1.7 的领域 API：Typert Remote `ctx.remote.credentials`。
     * 命名空间是 cordis 服务 `remote.credentials`，必须在 inject 里声明才能访问。
     * @param {object} rctx 已注入 remote 命名空间的上下文。
     */
    function makeCredentialsApi(rctx) {
      var remote = rctx.remote;
      if (remote == null || remote.credentials == null) return null;
      var credentials = remote.credentials;
      return {
        describe: function (refs) {
          return Promise.resolve(credentials.describe(refs)).then(function (result) {
            if (!result || result.ok !== true) throw new Error(remoteFailureMessage(result));
            return result.value || {};
          });
        },
        set: function (ref, value) {
          return Promise.resolve(credentials.set(ref, value)).then(function (result) {
            if (!result || result.ok !== true) throw new Error(remoteFailureMessage(result));
          });
        }
      };
    }

    /** 卡片单例：scope（configForms 的 form）与 credentials API 由 apply 注入。 */
    var Card = {
      scope: null,
      ctx: null,
      api: null,
      remoteCtx: null
    };

    function currentApi() {
      if (Card.api != null) return Card.api;
      if (Card.remoteCtx != null) {
        Card.api = makeCredentialsApi(Card.remoteCtx);
        if (Card.api != null) return Card.api;
      }
      return null;
    }

    var CHEVRON_D = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C7.78438 9.13382 7.55843 8.90706 7.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

    function Chevron(props) {
      return react.createElement("svg", {
        width: 14,
        height: 14,
        viewBox: "0 0 14 14",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
        className: props.className
      }, react.createElement("path", { d: CHEVRON_D, fill: "currentColor" }));
    }

    function SearchPoolCard(props) {
      var scope = Card.scope;
      var view = props && props.view === "summary" ? "summary" : "page";
      var snapshotState = react.useState(function () { return scope == null ? null : scope.getSnapshot(); });
      var snapshot = snapshotState[0];
      var setSnapshot = snapshotState[1];

      react.useEffect(function () {
        if (scope == null) return;
        setSnapshot(scope.getSnapshot());
        return scope.subscribe(function () { setSnapshot(scope.getSnapshot()); });
      }, []);

      var status = snapshot ? snapshot.status : "loading";
      var config = status === "ready" && snapshot && snapshot.value ? snapshot.value : null;

      var draftState = react.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var saveErrorState = react.useState(null);
      var saveError = saveErrorState[0];
      var setSaveError = saveErrorState[1];
      var savingState = react.useState(false);
      var saving = savingState[0];
      var setSaving = savingState[1];
      var credentialsState = react.useState({});
      var credentials = credentialsState[0];
      var setCredentials = credentialsState[1];
      var secretDraftsState = react.useState({});
      var secretDrafts = secretDraftsState[0];
      var setSecretDrafts = secretDraftsState[1];
      var collapsedKeysState = react.useState({});
      var collapsedKeys = collapsedKeysState[0];
      var setCollapsedKeys = collapsedKeysState[1];
      var openState = react.useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      // describeCredentials 的序号守卫：并发/过期响应直接丢弃。
      var credSeq = react.useRef(0);
      function describeCredentials(refs) {
        var api = currentApi();
        if (api == null || refs.length === 0) {
          setCredentials({});
          return;
        }
        var seq = ++credSeq.current;
        api.describe(refs).then(function (views) {
          if (seq !== credSeq.current) return;
          var next = {};
          refs.forEach(function (ref) {
            var view = views[ref];
            next[ref] = { configured: !!(view && view.configured), writable: !!(view && view.writable !== false) };
          });
          setCredentials(next);
        }).catch(function (e) {
          if (seq !== credSeq.current) return;
          console.warn("search-pool: describe credentials failed", e);
        });
      }

      react.useEffect(function () {
        if (config == null) return;
        setDraft(function (prev) {
          if (prev != null) return prev;
          setSecretDrafts({});
          return editableCopy(config);
        });
        describeCredentials(collectRefs(config));
      }, [config]);

      react.useEffect(function () {
        if (Card.ctx == null) return;
        return Card.ctx.effect(function () {
          return Card.ctx.remote.$on("credentials/reference-updated", function (ref) {
            describeCredentials([ref]);
          });
        }, "dsh-web-search-pool: credential invalidations");
      }, []);

      if (view === "summary") {
        var count = config == null ? 0 : collectRefs(config).length;
        return react.createElement("span", { className: "sp-desc" },
          "多 key 多供应商（Tavily + Exa）按限流负载均衡" + (count > 0 ? "，已配置 " + count + " 个 key" : ""));
      }

      if (config == null) {
        return react.createElement("li", { className: "sp-card" },
          react.createElement("div", { className: "sp-header", role: "status" },
            react.createElement("span", { className: "sp-headText" },
              react.createElement("span", { className: "sp-name" }, "搜索 Key 池"),
              react.createElement("span", { className: "sp-desc" }, "多 key 多供应商（Tavily + Exa）按限流负载均衡"))),
          react.createElement("div", { className: "sp-body" },
            react.createElement("div", { className: "sp-field" },
              react.createElement("p", { className: "sp-hint" },
                status === "unavailable"
                  ? "设置 namespace 不可用：确认 profile 已挂载 dsh-web-search-pool 并重启 DSH。"
                  : "加载中…"))));
      }

      function save() {
        if (draft == null || saving) return;
        var allKeys = draft.tavilyKeys.concat(draft.exaKeys);
        var invalid = allKeys.filter(function (k) {
          return k.apiKeyEnv != null && k.apiKeyEnv.length > 0 && !isValidEnvName(k.apiKeyEnv);
        }).map(function (k) { return k.apiKeyEnv; });
        if (invalid.length > 0) {
          setSaveError("环境变量名无效：" + invalid.join(", ") + "；应填 TAVILY_API_KEY_1 这类环境变量名，不是 API key 值");
          return;
        }
        var api = currentApi();
        var secretWrites = [];
        var liveRefs = [];
        if (api != null) {
          allKeys.forEach(function (k) {
            if (k.apiKeyEnv && liveRefs.indexOf(k.apiKeyEnv) === -1) liveRefs.push(k.apiKeyEnv);
          });
          var byUid = {};
          allKeys.forEach(function (k) { if (k._uid) byUid[k._uid] = k; });
          var missingRefs = [];
          Object.keys(secretDrafts).forEach(function (uid) {
            var value = secretDrafts[uid];
            if (value == null || String(value).trim().length === 0) return;
            var keyDraft = byUid[uid];
            var ref = keyDraft && keyDraft.apiKeyEnv;
            if (ref == null || String(ref).length === 0) {
              missingRefs.push((keyDraft && keyDraft.remark) || uid);
              return;
            }
            secretWrites.push(api.set(ref, String(value).trim()));
          });
          if (missingRefs.length > 0) {
            setSaveError("已输入密钥但环境变量名为空，无法写入：" + missingRefs.join("、") + "；请先填写环境变量名再保存");
            return;
          }
        }
        var ops = buildOps(draft, config);
        setSaveError(null);
        setSaving(true);
        function commit() {
          if (ops.length === 0) {
            setSaving(false);
            setSecretDrafts({});
            setDraft(null);
            setOpen(false);
            describeCredentials(liveRefs);
            return;
          }
          Promise.resolve(scope.mutate(ops, snapshot.revision)).then(function (ok) {
            setSaving(false);
            if (ok !== true) {
              setSaveError("保存设置失败：Host 拒绝了这些值（可能已被别处修改），请重新打开再试");
              return;
            }
            setSecretDrafts({});
            setDraft(null);
            setOpen(false);
            describeCredentials(liveRefs);
          }).catch(function (e) {
            setSaving(false);
            setSaveError("保存设置失败：" + String(e && e.message || e));
          });
        }
        if (secretWrites.length === 0) {
          commit();
          return;
        }
        Promise.all(secretWrites).then(commit).catch(function (e) {
          setSaving(false);
          setSaveError("写入密钥失败：" + String(e && e.message || e));
        });
      }

      function closeCard() {
        setDraft(null);
        setSecretDrafts({});
        setSaveError(null);
        setOpen(false);
      }

      function toggleOpen() {
        if (!open && draft == null && config != null) {
          setDraft(editableCopy(config));
          setSecretDrafts({});
          setSaveError(null);
        }
        setOpen(!open);
      }

      function setField(field, value) {
        setDraft(function (d) {
          if (d == null) return d;
          var next = {};
          next[field] = value;
          return Object.assign({}, d, next);
        });
      }

      function setPriority(text) {
        var parts = String(text).split(/[\s,，]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        setField("providerPriority", parts.length > 0 ? parts : ["tavily", "exa"]);
      }

      function setKeys(provider, keys) {
        var field = provider === "tavily" ? "tavilyKeys" : "exaKeys";
        setDraft(function (d) {
          if (d == null) return d;
          var next = {};
          next[field] = keys;
          return Object.assign({}, d, next);
        });
      }

      function updateKey(provider, index, key, value) {
        var list = provider === "tavily" ? draft.tavilyKeys : draft.exaKeys;
        setKeys(provider, list.map(function (k, i) {
          if (i !== index) return k;
          var next = {};
          next[key] = value;
          return Object.assign({}, k, next);
        }));
      }

      function addKey(provider) {
        var list = provider === "tavily" ? draft.tavilyKeys : draft.exaKeys;
        var uid = provider + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
        setKeys(provider, list.concat([{ _uid: uid, apiKeyEnv: "", rpm: "60", remark: "" }]));
      }

      function removeKey(provider, index) {
        var list = provider === "tavily" ? draft.tavilyKeys : draft.exaKeys;
        setKeys(provider, list.filter(function (_, i) { return i !== index; }));
      }

      function updateSecretDraft(uid, value) {
        var next = {};
        next[uid] = value;
        setSecretDrafts(Object.assign({}, secretDrafts, next));
      }

      function keyBlock(provider, k, i) {
        var ref = k.apiKeyEnv || "";
        var state = ref && credentials[ref] ? credentials[ref] : { configured: false, writable: true };
        var anonymous = provider === "exa";
        var anonymousFree = anonymous && !state.configured;
        var secretUid = k._uid || (provider + ":" + i);
        var secretDraft = secretDrafts[secretUid] != null ? secretDrafts[secretUid] : "";
        var secretPlaceholder = state.configured
          ? "已配置，留空保持"
          : anonymous
            ? "留空走免费匿名；填 key 提高配额"
            : "未配置，输入后保存";
        var isSaved = Boolean(ref) || anonymousFree;
        var collapsed = collapsedKeys[secretUid] != null ? collapsedKeys[secretUid] : isSaved;
        function toggleCollapsed() {
          var next = {};
          next[secretUid] = !collapsed;
          setCollapsedKeys(Object.assign({}, collapsedKeys, next));
        }
        var displayName = (k.remark && k.remark.length > 0)
          ? k.remark
          : ref.length > 0 ? ref : anonymous ? "Exa 匿名" : "新 key";
        var statusLabel = state.configured ? "已配置" : anonymous ? "免费匿名" : "未配置";
        return react.createElement("div", { key: i, className: "sp-keyBlock" },
          react.createElement("div", { className: "sp-keySummary", role: "button", tabIndex: 0, "aria-expanded": !collapsed, onClick: toggleCollapsed, onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapsed(); } } },
            react.createElement("span", { className: "sp-keyName" }, displayName),
            react.createElement("span", { className: state.configured ? "sp-badge" : "sp-badgeMuted" }, statusLabel),
            react.createElement(Chevron, { className: "sp-chevron" + (collapsed ? "" : " sp-chevronOpen") })
          ),
          collapsed ? null : react.createElement("div", { className: "sp-keyDetails" },
            react.createElement("div", { className: "sp-keyRow" },
              react.createElement("input", {
                className: "sp-input sp-keyInput",
                value: k.apiKeyEnv,
                placeholder: anonymous ? "环境变量名；留空使用匿名免费层" : "环境变量名，如 TAVILY_API_KEY_1",
                onChange: function (e) { updateKey(provider, i, "apiKeyEnv", e.target.value); }
              }),
              react.createElement("input", {
                className: "sp-input sp-remarkInput",
                value: k.remark,
                placeholder: "备注",
                onChange: function (e) { updateKey(provider, i, "remark", e.target.value); }
              }),
              react.createElement("button", { type: "button", className: "sp-remove", onClick: function () { removeKey(provider, i); } }, "删除")
            ),
            react.createElement("div", { className: "sp-metricRow" },
              react.createElement("label", { className: "sp-fieldLabel" }, "限速"),
              anonymousFree
                ? react.createElement("span", { className: "sp-hint" }, "1 次/秒（匿名共享，不可改）")
                : react.createElement("input", {
                  className: "sp-input sp-metricInput",
                  value: k.rpm,
                  inputMode: "numeric",
                  placeholder: "60",
                  onChange: function (e) { updateKey(provider, i, "rpm", e.target.value); }
                }),
              anonymousFree ? null : react.createElement("span", { className: "sp-hint" }, "次/分钟")
            ),
            react.createElement("div", { className: "sp-secretRow" },
              react.createElement("div", { className: "sp-secretHead" },
                react.createElement("label", { className: "sp-label" }, "密钥"),
                react.createElement("span", { className: state.configured ? "sp-badge" : "sp-badgeMuted" }, statusLabel)
              ),
              react.createElement("input", {
                type: "password",
                className: "sp-input sp-secretInput",
                value: secretDraft,
                placeholder: secretPlaceholder,
                autoComplete: "off",
                disabled: !state.writable,
                onChange: function (e) { updateSecretDraft(secretUid, e.target.value); }
              })
            )
          )
        );
      }

      function fieldHead(label, badge) {
        return react.createElement("div", { className: "sp-head" },
          react.createElement("label", { className: "sp-label" }, label),
          badge || null
        );
      }

      function metricRow(label, control, hint) {
        return react.createElement("div", { className: "sp-metricRow" },
          react.createElement("label", { className: "sp-fieldLabel" }, label),
          control,
          hint || null
        );
      }

      function numberInput(value, placeholder, onChange) {
        return react.createElement("input", {
          className: "sp-input sp-metricInput",
          value: value,
          inputMode: "numeric",
          placeholder: placeholder,
          onChange: onChange
        });
      }

      var tavilyKeys = draft != null ? draft.tavilyKeys : [];
      var exaKeys = draft != null ? draft.exaKeys : [];

      return react.createElement("li", { className: "sp-card" + (open ? " sp-cardOpen" : "") },
        react.createElement("button", { type: "button", className: "sp-header", "aria-expanded": open, onClick: toggleOpen },
          react.createElement("span", { className: "sp-headText" },
            react.createElement("span", { className: "sp-name" }, "搜索 Key 池"),
            react.createElement("span", { className: "sp-desc" }, "多 key 多供应商（Tavily + Exa）按限流负载均衡")
          ),
          react.createElement("span", { className: "sp-badge" }, String(tavilyKeys.length + exaKeys.length) + " 个 key"),
          react.createElement(Chevron, { className: "sp-chevron" + (open ? " sp-chevronOpen" : "") })
        ),
        open ? react.createElement("div", { className: "sp-body" },
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("启用搜索 Key 池"),
            react.createElement("label", { className: "sp-switchRow" },
              react.createElement("input", {
                type: "checkbox",
                checked: draft.enabled,
                onChange: function (e) { setField("enabled", e.target.checked); }
              }),
              react.createElement("span", { className: "sp-switchLabel" }, draft.enabled ? "开启（使用 key 池搜索）" : "关闭（使用 DeepSeek 官方搜索）")
            ),
            react.createElement("p", { className: "sp-hint" }, "关闭时自动切换回原有网页搜索，避免两个搜索提供方冲突。")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("策略"),
            react.createElement("select", {
              className: "sp-select",
              value: draft.strategy,
              onChange: function (e) { setField("strategy", e.target.value); }
            },
              react.createElement("option", { value: "weighted-round-robin" }, "加权轮询（按 rpm 权重）"),
              react.createElement("option", { value: "least-used" }, "最少使用（剩余配额最多优先）")
            ),
            react.createElement("p", { className: "sp-hint" }, "key 池的调度策略。")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("供应商优先级"),
            react.createElement("input", {
              className: "sp-input",
              value: draft.providerPriority.join(", "),
              placeholder: "tavily, exa",
              onChange: function (e) { setPriority(e.target.value); }
            }),
            react.createElement("p", { className: "sp-hint" }, "逗号分隔；前面的供应商优先，失败后向后 failover。")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("熔断 / 冷却"),
            metricRow("连续失败次数",
              numberInput(draft.allowedFails, "3", function (e) { setField("allowedFails", e.target.value); })),
            metricRow("冷却时长",
              numberInput(draft.cooldownMs, "30000", function (e) { setField("cooldownMs", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "毫秒")),
            metricRow("失败后等待",
              numberInput(draft.retryAfterFallbackMs, "1000", function (e) { setField("retryAfterFallbackMs", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "毫秒，429 无 Retry-After 时用")),
            metricRow("请求超时",
              numberInput(draft.requestTimeoutMs, "20000", function (e) { setField("requestTimeoutMs", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "毫秒，0 禁用；超时自动换下一个 key")),
            react.createElement("p", { className: "sp-hint" }, "连续失败达到次数后冷却；429 的 Retry-After 会覆盖冷却时长。")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("额度控制"),
            metricRow("刷新间隔",
              numberInput(draft.usageCacheMs, "300000", function (e) { setField("usageCacheMs", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "毫秒")),
            metricRow("保留下次额度",
              numberInput(draft.quotaReserveCredits, "2", function (e) { setField("quotaReserveCredits", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "credits，Tavily advanced 搜索为 2")),
            metricRow("额度耗尽长冷却",
              numberInput(draft.quotaExhaustedHours, "720", function (e) { setField("quotaExhaustedHours", e.target.value); }),
              react.createElement("span", { className: "sp-hint" }, "小时，默认 720（30 天）")),
            react.createElement("p", { className: "sp-hint" }, "Tavily 剩余额度低于保留值时自动进入长冷却；额度刷新恢复后自动解除。额度总览见 DSH 日志（search-pool usage …）。")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("Tavily keys", react.createElement("span", { className: "sp-badge" }, String(tavilyKeys.length) + " 个")),
            tavilyKeys.map(function (k, i) { return keyBlock("tavily", k, i); }),
            react.createElement("button", { type: "button", className: "sp-add", onClick: function () { addKey("tavily"); } }, "添加 Tavily key")
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("Exa keys", react.createElement("span", { className: "sp-badge" }, String(exaKeys.length) + " 个")),
            exaKeys.map(function (k, i) { return keyBlock("exa", k, i); }),
            react.createElement("button", { type: "button", className: "sp-add", onClick: function () { addKey("exa"); } }, "添加 Exa key"),
            react.createElement("p", { className: "sp-hint" }, "匿名（未配置 key）时所有 Exa 搜索共享强制 1 秒 1 次限流；填 key 走 REST 不受此限制。")
          ) : null,
          saveError != null ? react.createElement("div", { className: "sp-field" },
            react.createElement("p", { className: "sp-error", role: "alert" }, saveError)
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-footer" },
            react.createElement("button", { type: "button", className: "sp-discard", onClick: closeCard }, "取消"),
            react.createElement("button", { type: "button", className: "sp-save", disabled: saving, onClick: save }, saving ? "保存中…" : "保存")
          ) : null
        ) : null
      );
    }

    function apply(ctx) {
      Card.ctx = ctx;
      Card.scope = ctx.configForms.get(SETTINGS_NS);
      // remote 命名空间（cordis 服务 `remote.credentials`）必须显式 inject 才能访问。
      ctx.inject(["remote", "remote.credentials"], function (rctx) {
        Card.remoteCtx = rctx;
        Card.api = makeCredentialsApi(rctx);
      });
      ctx.effect(function () {
        return ctx.configForms.whileServed([SETTINGS_NS], function () {
          return ctx.slots.inject("plugins.row.config", function () {
            return ctx.slots.register({
              name: "plugins.row.config",
              key: ROW_CONFIG_KEY
            }, SearchPoolCard);
          });
        });
      }, "dsh-web-search-pool: settings card");
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote", "remote.credentials", "configForms"];
    return module.exports;
  }
});
