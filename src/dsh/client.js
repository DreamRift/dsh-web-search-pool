/**
 * dsh-web-search-pool 的浏览器端 client half。
 *
 * 在设置页 插件 → 插件配置 的「网页搜索」卡片下方注册「搜索 Key 池」卡片：
 * 读 `web-search-pool` settings namespace 展示并编辑 key 池配置（开关/策略/优先级/熔断/key 增删/备注）。
 * 每个 key 的密钥与 harness 其他密钥输入一致：write-only password，不显示明文，只显示「已配置/未配置」；
 * 留空保持当前密钥，输入新值并保存则覆盖。
 */

window.__ModuleLoader__.load({
  id: "dsh-web-search-pool",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var CSS = ".sp-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.sp-card:hover{border-color:var(--dsw-alias-label-dimmed)}.sp-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.sp-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.sp-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.sp-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.sp-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.sp-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.sp-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.sp-chevronOpen{transform:rotate(180deg)}.sp-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.sp-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.sp-field+.sp-field{border-top:1px solid var(--dsw-alias-border-l2)}.sp-head{align-items:center;gap:8px;display:flex}.sp-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.sp-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.sp-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.sp-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.sp-input,.sp-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.sp-input:focus-visible,.sp-select:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.sp-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.sp-select{width:100%}.sp-switchRow{align-items:center;gap:8px;display:flex;cursor:pointer}.sp-switch{width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}.sp-switchLabel{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}.sp-keyBlock{flex-direction:column;gap:6px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l2);display:flex}.sp-keySummary{align-items:center;gap:8px;cursor:pointer;display:flex}.sp-keySummary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.sp-keyName{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sp-keyDetails{flex-direction:column;gap:6px;display:flex}.sp-keyBlock:first-child{border-top:0}.sp-keyRow{align-items:center;gap:8px;display:flex}.sp-keyInput{flex:1;min-width:0}.sp-remarkInput{width:150px;flex:none}.sp-rpmInput{width:84px;flex:none}.sp-secretRow{flex-direction:column;gap:6px;display:flex}.sp-secretHead{align-items:center;gap:8px;display:flex}.sp-secretInput{width:100%;min-width:0;box-sizing:border-box}.sp-metricRow{align-items:center;gap:8px;display:flex}.sp-fieldLabel{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.sp-metricInput{flex:1;min-width:0}.sp-badgeExhausted{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-error);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.sp-usageRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.sp-usageStat{color:var(--dsw-alias-label-secondary);border-radius:8px;padding:2px 8px;background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:20px}.sp-add,.sp-remove{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:12px;line-height:1.5}.sp-add{color:var(--dsw-alias-label-secondary);background:0 0;padding:5px 12px;align-self:flex-start}.sp-remove{color:var(--dsw-alias-label-secondary);background:0 0;padding:5px 10px;flex:none}.sp-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.sp-discard,.sp-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.sp-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.sp-save{background:var(--dsw-alias-brand-primary);color:#fff}.sp-save:disabled{opacity:.4;cursor:default}.sp-discard:focus-visible,.sp-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";

    var CSS_TAG = "dsh-web-search-pool/client-card.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-web-search-pool";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 刷新提示自动消失与按钮恢复的时长（毫秒）。 */
    var NOTE_AUTO_CLEAR_MS = 15000;
    var REFRESH_BUTTON_REARM_MS = 5000;
    /** 额度耗尽长冷却的默认值（30 天，毫秒），与 Host 侧 DEFAULTS 对齐。 */
    var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    var CHEVRON_D = "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

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

    function editableCopy(config) {
      return {
        strategy: config.strategy || "weighted-round-robin",
        providerPriority: Array.isArray(config.providerPriority) ? config.providerPriority.slice() : ["tavily", "exa"],
        allowedFails: String(config.allowedFails != null ? config.allowedFails : 3),
        cooldownMs: String(config.cooldownMs != null ? config.cooldownMs : 30000),
        retryAfterFallbackMs: String(config.retryAfterFallbackMs != null ? config.retryAfterFallbackMs : 1000),
        usageCacheMs: String(config.usageCacheMs != null ? config.usageCacheMs : 300000),
        quotaReserveCredits: String(config.quotaReserveCredits != null ? config.quotaReserveCredits : 2),
        quotaExhaustedHours: String((config.quotaExhaustedCooldownMs != null ? config.quotaExhaustedCooldownMs : THIRTY_DAYS_MS) / 3600000),
        requestTimeoutMs: String(config.requestTimeoutMs != null ? config.requestTimeoutMs : 20000),
        tavilyKeys: (config.providers && config.providers.tavily && Array.isArray(config.providers.tavily.keys) ? config.providers.tavily.keys : []).map(function (k, index) {
          return { _uid: "t" + index, apiKeyEnv: k.apiKeyEnv || "", rpm: String(k.rpm != null ? k.rpm : 60), remark: k.remark || "" };
        }),
        exaKeys: (config.providers && config.providers.exa && Array.isArray(config.providers.exa.keys) ? config.providers.exa.keys : []).map(function (k, index) {
          return { _uid: "e" + index, apiKeyEnv: k.apiKeyEnv || "", rpm: String(k.rpm != null ? k.rpm : 60), remark: k.remark || "" };
        })
      };
    }

    function toNumber(text, fallback) {
      var value = Number(String(text == null ? "" : text).trim());
      return Number.isFinite(value) ? value : fallback;
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

    function SearchPoolCard() {
      var scope = SearchPoolCard.scope;
      var api = SearchPoolCard.api;
      var hooks = react.useState(false);
      var open = hooks[0];
      var setOpen = hooks[1];
      var snapshotState = react.useState(function () { return scope.getSnapshot(); });
      var snapshot = snapshotState[0];
      var setSnapshot = snapshotState[1];
      var draftState = react.useState(null);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var saveErrorState = react.useState(null);
      var saveError = saveErrorState[0];
      var setSaveError = saveErrorState[1];
      var credentialsState = react.useState({});
      var credentials = credentialsState[0];
      var setCredentials = credentialsState[1];
      var secretDraftsState = react.useState({});
      var secretDrafts = secretDraftsState[0];
      var setSecretDrafts = secretDraftsState[1];
      var collapsedKeysState = react.useState({});
      var collapsedKeys = collapsedKeysState[0];
      var setCollapsedKeys = collapsedKeysState[1];
      var refreshingState = react.useState(false);
      var refreshing = refreshingState[0];
      var setRefreshing = refreshingState[1];
      var refreshNoteState = react.useState(null);
      var refreshNote = refreshNoteState[0];
      var setRefreshNote = refreshNoteState[1];

      // ── 定时器管理：全部经 setLater 登记，组件卸载时统一清理，避免泄漏与卸载后 setState ──
      var timers = react.useRef([]);
      function setLater(fn, ms) {
        var id = window.setTimeout(fn, ms);
        timers.current.push(id);
        return id;
      }
      react.useEffect(function () {
        return function () {
          timers.current.forEach(function (id) { window.clearTimeout(id); });
          timers.current = [];
        };
      }, []);

      react.useEffect(function () {
        setSnapshot(scope.getSnapshot());
        return scope.subscribe(function () { setSnapshot(scope.getSnapshot()); });
      }, []);

      var status = snapshot ? snapshot.status : "loading";
      var config = snapshot && snapshot.value ? snapshot.value : null;

      // describeCredentials 的序号守卫：并发调用/卸载后返回的过期响应直接丢弃，防止旧状态覆盖新状态。
      var credSeq = react.useRef(0);
      function describeCredentials(refs) {
        if (api == null || refs.length === 0) {
          setCredentials({});
          return;
        }
        var seq = ++credSeq.current;
        api.credentials.describe({ refs: refs }).then(function (response) {
          if (seq !== credSeq.current) return;
          if (!response || !response.result || !response.result.ok) return;
          var next = {};
          refs.forEach(function (ref) {
            var view = response.result.value.credentials[ref];
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

      function save() {
        if (draft == null || config == null) return;
        var invalid = draft.tavilyKeys.concat(draft.exaKeys).filter(function (k) {
          return k.apiKeyEnv != null && k.apiKeyEnv.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.apiKeyEnv);
        }).map(function (k) { return k.apiKeyEnv; });
        if (invalid.length > 0) {
          setSaveError("环境变量名无效：" + invalid.join(", ") + "；应填 TAVILY_API_KEY_1 这类环境变量名，不是 API key 值");
          return;
        }
        setSaveError(null);
        var secretWrites = [];
        var liveRefs = [];
        var secretKeys = draft.tavilyKeys.concat(draft.exaKeys);
        if (api != null) {
          secretKeys.forEach(function (k) {
            if (k.apiKeyEnv && liveRefs.indexOf(k.apiKeyEnv) === -1) liveRefs.push(k.apiKeyEnv);
          });
          var byUid = {};
          secretKeys.forEach(function (k) { if (k._uid) byUid[k._uid] = k; });
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
            secretWrites.push(api.credentials.set({ ref: ref, value: String(value).trim() }));
          });
          if (missingRefs.length > 0) {
            setSaveError("已输入密钥但环境变量名为空，无法写入：" + missingRefs.join("、") + "；请先填写环境变量名再保存");
            return;
          }
        }
        function afterCommit() {
          setSecretDrafts({});
          describeCredentials(liveRefs);
          closeCard();
        }
        function commitSettings() {
          var values = {
            strategy: draft.strategy,
            providerPriority: draft.providerPriority,
            allowedFails: toNumber(draft.allowedFails, 3),
            cooldownMs: toNumber(draft.cooldownMs, 30000),
            retryAfterFallbackMs: toNumber(draft.retryAfterFallbackMs, 1000),
            usageCacheMs: toNumber(draft.usageCacheMs, 300000),
            quotaReserveCredits: toNumber(draft.quotaReserveCredits, 2),
            quotaExhaustedCooldownMs: Math.round(toNumber(draft.quotaExhaustedHours, 720) * 3600000),
            requestTimeoutMs: toNumber(draft.requestTimeoutMs, 20000),
            providers: {
              tavily: Object.assign({}, config.providers && config.providers.tavily ? config.providers.tavily : {}, {
                keys: draft.tavilyKeys.map(function (k) { return Object.assign({ apiKeyEnv: k.apiKeyEnv, rpm: toNumber(k.rpm, 60) }, k.remark && k.remark.length > 0 ? { remark: k.remark } : {}); })
              }),
              exa: Object.assign({}, config.providers && config.providers.exa ? config.providers.exa : {}, {
                keys: draft.exaKeys.map(function (k) { return Object.assign({ apiKeyEnv: k.apiKeyEnv, rpm: toNumber(k.rpm, 60) }, k.remark && k.remark.length > 0 ? { remark: k.remark } : {}); })
              })
            }
          };
          if (api != null && api.settings != null && typeof api.settings.mutate === "function") {
            // 单次事务提交全部字段（多个 op 一次 mutate），避免逐字段 set 造成的
            // 多次 revision 冲突面与多次更新广播。
            api.settings.mutate({
              ns: "web-search-pool",
              ops: Object.keys(values).map(function (key) {
                return { op: "set", path: [key], value: values[key] };
              })
            }).then(afterCommit).catch(function (e) {
              setSaveError("保存设置失败：" + String(e && e.message || e));
            });
            return;
          }
          // 回退路径（无 api.settings）：逐字段 scope.set。
          Object.keys(values).forEach(function (key) { scope.set(key, values[key]); });
          afterCommit();
        }
        if (secretWrites.length === 0) {
          commitSettings();
          return;
        }
        Promise.all(secretWrites).then(commitSettings).catch(function (e) {
          setSaveError("写入密钥失败：" + String(e && e.message || e));
        });
      }

      var noteTimer = react.useRef(null);
      var rearmTimer = react.useRef(null);
      function showRefreshNote(text) {
        setRefreshNote(text);
        if (noteTimer.current != null) window.clearTimeout(noteTimer.current);
        noteTimer.current = setLater(function () {
          noteTimer.current = null;
          setRefreshNote(null);
        }, NOTE_AUTO_CLEAR_MS);
      }
      function refreshUsage() {
        if (config == null || refreshing) return;
        setRefreshing(true);
        if (rearmTimer.current != null) window.clearTimeout(rearmTimer.current);
        rearmTimer.current = setLater(function () {
          rearmTimer.current = null;
          setRefreshing(false);
        }, REFRESH_BUTTON_REARM_MS);
        var tick = (config.usageRefreshTick != null ? config.usageRefreshTick : 0) + 1;
        if (api != null && api.settings != null && typeof api.settings.mutate === "function") {
          // 不带 expectedRevision，避免 Host 刚写 usage 导致 revision 冲突而点击无反应。
          api.settings.mutate({
            ns: "web-search-pool",
            ops: [{ op: "set", path: ["usageRefreshTick"], value: tick }],
          }).then(function () {
            showRefreshNote("已请求刷新，等待 Host 回写…");
          }).catch(function (e) {
            showRefreshNote("刷新请求失败：" + String(e && e.message || e));
          });
        } else {
          try {
            scope.set("usageRefreshTick", tick);
            showRefreshNote("已请求刷新，等待 Host 回写…");
          } catch (e) {
            showRefreshNote("刷新请求失败：" + String(e && e.message || e));
          }
        }
      }

      function closeCard() {
        setDraft(null);
        setSecretDrafts({});
        setSaveError(null);
        setOpen(false);
      }

      function toggleOpen() {
        if (!open && draft == null) {
          setDraft(config ? editableCopy(config) : null);
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

      function updateSecretDraft(ref, value) {
        var next = {};
        next[ref] = value;
        setSecretDrafts(Object.assign({}, secretDrafts, next));
      }

      function keyBlock(provider, k, i) {
        var ref = k.apiKeyEnv || "";
        var state = ref && credentials[ref] ? credentials[ref] : { configured: false, writable: true };
        var anonymous = provider === "exa";
        var anonymousFree = anonymous && !state.configured;
        var reserve = config && config.quotaReserveCredits != null ? config.quotaReserveCredits : 2;
        var usageView = null;
        if (ref && config && config.usage && Array.isArray(config.usage.keys)) {
          config.usage.keys.forEach(function (u) { if (u.ref === ref) usageView = u; });
        }
        var exhausted = usageView != null && usageView.remaining >= 0 && usageView.remaining < reserve;
        var usageLabel = anonymous
          ? "不计余额"
          : usageView == null
            ? "额度未查询"
            : usageView.remaining < 0
              ? "额度未知"
              : exhausted
                ? "剩余 " + usageView.remaining + "，额度不足"
                : "已用 " + usageView.used + " / 剩余 " + usageView.remaining;
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
            react.createElement("span", { className: exhausted ? "sp-badgeExhausted" : "sp-badge" }, usageLabel),
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

      /** 「标签 + 控件 + 单位提示」一行的统一结构（熔断/额度控制等表单区复用）。 */
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
          config != null ? react.createElement("span", { className: "sp-badge" }, String((config.providers && config.providers.tavily && config.providers.tavily.keys ? config.providers.tavily.keys.length : 0) + (config.providers && config.providers.exa && config.providers.exa.keys ? config.providers.exa.keys.length : 0)) + " 个 key") : null,
          react.createElement(Chevron, { className: "sp-chevron" + (open ? " sp-chevronOpen" : "") })
        ),
        open ? react.createElement("div", { className: "sp-body" },
          config == null ? react.createElement("div", { className: "sp-field" },
            react.createElement("p", { className: "sp-hint" }, status === "unavailable" ? "设置 namespace 不可用：检查 profile 已挂载 dsh-web-search-pool、已运行 scripts/patch-api-proxy-namespace.mjs 暴露 web-search-pool，并重启 DSH" : "加载中…")
          ) : null,
          config != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("启用搜索 Key 池"),
            react.createElement("label", { className: "sp-switchRow" },
              react.createElement("input", {
                type: "checkbox",
                className: "sp-switch",
                checked: config.enabled !== false,
                onChange: function (e) { scope.set("enabled", e.target.checked); }
              }),
              react.createElement("span", { className: "sp-switchLabel" }, config.enabled !== false ? "开启（使用 key 池搜索）" : "关闭（使用 DeepSeek 官方搜索）")
            ),
            react.createElement("p", { className: "sp-hint" }, "关闭时自动切换回原有网页搜索，避免两个搜索提供方冲突。")
          ) : null,
          config != null ? react.createElement("div", { className: "sp-field" },
            fieldHead("Tavily 额度总览", react.createElement("button", { type: "button", className: "sp-add", disabled: refreshing, onClick: refreshUsage }, refreshing ? "刷新中…" : "立即刷新")),
            react.createElement("div", { className: "sp-usageRow" },
              react.createElement("span", { className: "sp-usageStat" }, "已用 " + (config.usage ? config.usage.totalUsed : "—")),
              react.createElement("span", { className: "sp-usageStat" }, "可用 " + (config.usage && config.usage.totalLimit > 0 ? Math.max(0, config.usage.totalLimit - config.usage.totalUsed) : "—")),
              react.createElement("span", { className: "sp-usageStat" }, "上限 " + (config.usage && config.usage.totalLimit > 0 ? config.usage.totalLimit : "—")),
              react.createElement("span", { className: "sp-usageStat" }, "更新 " + (config.usage && config.usage.updatedAt > 0 ? new Date(config.usage.updatedAt).toLocaleTimeString() : "等待刷新"))
            ),
            refreshNote != null ? react.createElement("p", { className: "sp-hint" }, refreshNote) : null,
            react.createElement("p", { className: "sp-hint" }, config.usageDiagnostic ? "诊断：" + config.usageDiagnostic : "仅统计已配置凭据的 Tavily key；Exa 无公开余额接口，不计入。")
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
            react.createElement("p", { className: "sp-hint" }, "Tavily 剩余额度低于保留值时自动进入长冷却；额度刷新恢复后自动解除。")
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
            react.createElement("p", { className: "sp-hint", style: { color: "var(--dsw-alias-label-error)" } }, saveError)
          ) : null,
          draft != null ? react.createElement("div", { className: "sp-footer" },
            react.createElement("button", { type: "button", className: "sp-discard", onClick: closeCard }, "取消"),
            react.createElement("button", { type: "button", className: "sp-save", onClick: save }, "保存")
          ) : null
        ) : null
      );
    }

    function apply(ctx) {
      var scope = ctx.settingsScope.bind({ namespace: "web-search-pool" });
      var connection = ctx.get("connection");
      SearchPoolCard.scope = scope;
      SearchPoolCard.api = connection && connection.api ? connection.api : null;
      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "web-search-pool",
          order: 21
        }, SearchPoolCard);
      });
    }
    
    exports.apply = apply;
    exports.inject = ["settingsScope", "slots", "connection"];
    return module.exports;
  }
});
