// ComfyUI-ResolutionPresets 前端扩展
//
// 新增（v0.39）：
//   - 注册入口放宽到 ResolutionPresetsLatent（Latent 版）。该节点 INPUT_TYPES 与
//     INT 版完全一致，整套 setupResolutionPresets / 序列化逻辑原样复用，
//     无需任何分支判断——所有控件操作都是按 name 现取的。
//
// 关键修正（v0.38）：
//   - applySavedValues 改两段式回填：先把 enforce_multiple_of_8 等布尔控件
//     全部赋值完，再处理宽高。否则 normDim 在宽高阶段读到的是开关默认值 true，
//     保存的 900 会被抹成 904（实测复现）。
//   - onSerialize 钩子改为直接覆盖 o.widgets_values：litegraph 在调用钩子前
//     就按「显示顺序」生成序列化数组（按钮占 null、ratio 在末尾，共 11 项），
//     不覆盖的话保存的工作流下次载入会整体错位。
//
// 关键修正（v0.37）：
//   - 修复「强制 8 的倍数」开关形同虚设：clamp8() 原先在 applySavedValues /
//     syncResolutionPresetUI / applyRatio 三处被无条件调用，值在送达后端前就被抹平，
//     后端那个 `if enforce_multiple_of_8:` 分支永远收不到非 8 倍数。
//     现统一走 normDim()，由开关决定是 clamp8() 还是 clampFree()。
//   - clamp8() 与后端 get_resolution() 的取整规则必须一致（四舍五入）。
//     后端已同步改为 math.floor(x / 8 + 0.5)，不再用银行家舍入的 round()。
//   - 删除与后端重复的逻辑：node.title（NODE_DISPLAY_NAME_MAPPINGS）、
//     输出端口中文名（RETURN_NAMES）。
//   - 删除死代码 updating 标志（普通属性赋值不可能同步重入）。
//   - 删除重复的 nodeCreated 注册入口，只保留 beforeRegisterNodeDef。
//   - 改「宽高比」时以最后编辑的那一边为基准，不再固定按宽度反推。
//   - 去掉创建节点时的全量控件 console.log 与逐次重试的 console.warn。
//   - 把「宽高比」选择框移到「宽高比：锁定 / 自由」按钮正下方。
//   - widgets_values 的写入/读取改为固定走 WIDGET_NAMES 顺序，与 node.widgets 的
//     显示顺序解耦。这样调整控件布局不会再让已保存的工作流整体错位。
//     （graphToPrompt 是按 widget.name 取值的，本来就与顺序无关。）
//
// 保留的历史修正（v0.36）：
//   - 修复「按钮全部失灵」：回填 saved widgets_values 的逻辑原本写在 syncResolutionPresetUI 里，
//     导致每次点按钮 → 翻转布尔值 → 立刻 sync → 又被旧的 widgets_values 覆盖回去，状态永远变不了。
//     现改为只在「加载/配置阶段」回填一次（applySavedValues），日常刷新不再碰已保存值。
//   - 所有回调改为「用时按 name 现取控件」，不再长期持有控件引用，避免新前端重建控件后引用失效。
//   - 增加控件未就绪时的重试，兼容新前端异步初始化 widget 的时序。
//   - 增加 onSerialize 钩子，保存前同步 widgets_values，修复「重启后设置回到默认」。
//
// 保留的历史修正（v0.35）：
//   - 中文化必须改 `widget.label`，绝不能改 `widget.name`。
//   - 按钮必须显式 serialize=false，并且在任何会修改控件值的回调后
//     重新同步 `node.widgets_values`，否则 graphToPrompt 会按旧索引错位取值，
//     导致 custom_width/custom_height 拿到 bool/string 而报“输入值类型错误”。
//   - 自定义宽高在赋值时强制转为 8 的倍数整数，防止浮点/字符串进入后端。
//   - 必须在 graph configure 完成后再刷新一次 UI（按钮文字、显隐），否则重新打开
//     ComfyUI 时按钮会显示默认值而不是工作流保存的状态。

const { app } = window.comfyAPI.app;

// 这是「持久化顺序」，与后端 INPUT_TYPES 的声明顺序一致，也是 widgets_values 的取值顺序。
// 注意它不等于 node.widgets 的显示顺序 —— 显示顺序可以随意调整（见 moveWidgetAfter），
// 但写入 / 读取 widgets_values 一律走这里的固定顺序，两者互不干扰。
const WIDGET_NAMES = [
    "portrait",
    "custom_mode",
    "preset",
    "custom_width",
    "custom_height",
    "ratio_lock",
    "ratio",
    "enforce_multiple_of_8",
];

function setWidgetHidden(widget, hidden) {
    if (!widget) return;
    widget.hidden = hidden;
    if (widget.options) widget.options.hidden = hidden;
}

function makeButtonNonSerializing(w) {
    if (!w) return;
    w.serialize = false;
    if (!w.options) w.options = {};
    w.options.serialize = false;
}

// 取整规则必须与后端 resolution_presets.py 的 get_resolution() 完全一致。
// 后端用 math.floor(x / 8 + 0.5)（四舍五入）；若改回 Python 内置的 round()
// 会变成银行家舍入（900 → 896），与这里的 Math.round（900 → 904）差一个步长。
function clamp8(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 1024;
    return Math.max(64, Math.round(n / 8) * 8);
}

// 关掉「强制 8 的倍数」时：只做整数化与下界，不对齐到 8
function clampFree(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 1024;
    return Math.max(64, n);
}

// 是否对齐到 8 由「强制 8 的倍数」开关决定。
// 修复前这里无条件调用 clamp8，开关关掉也照样取整，导致该选项形同虚设。
function normDim(node, v) {
    const en = getWidgetsByName(node)["enforce_multiple_of_8"];
    return en && en.value === false ? clampFree(v) : clamp8(v);
}

function getWidgetsByName(node) {
    const byName = {};
    for (const w of node.widgets || []) {
        if (w && w.name) byName[w.name] = w;
    }
    return byName;
}

// 序列化顺序固定由 WIDGET_NAMES 决定，与 node.widgets 的排列顺序无关。
//
// 这一点很重要：渲染顺序（node.widgets 数组顺序）可以为了布局随意调整，
// 但只要这里是按数组顺序取值，一改布局就会让已保存工作流的 widgets_values 全部错位
// （例如把 ratio 挪到末尾，enforce_multiple_of_8 就会读到原来 ratio 的字符串）。
// 与 litegraph 的 configure 逻辑保持一致：跳过 serialize === false 的控件。
function rebuildWidgetsValues(node) {
    if (!node.widgets) return;
    const byName = getWidgetsByName(node);
    const vals = [];
    for (const name of WIDGET_NAMES) {
        const w = byName[name];
        if (!w) return;                 // 控件还没齐，别覆盖已有值
        if (w.serialize === false) continue;
        vals.push(w.value);
    }
    node.widgets_values = vals;
}

// 调整控件在节点上的显示顺序（只动 node.widgets 数组，不影响 widgets_values）。
//
// 之所以可以安全地挪：widgets_values 的写入 / 读取一律走 WIDGET_NAMES 的固定顺序，
// 与这里的显示顺序无关。configure() 阶段即使按显示顺序把值放错了位置，
// 也会被紧随其后的 applySavedValues() 按名字重新校正回来。
function moveWidgetAfter(node, widget, target) {
    if (!widget || !target || widget === target || !node.widgets) return;
    const from = node.widgets.indexOf(widget);
    const to = node.widgets.indexOf(target);
    if (from < 0 || to < 0) return;
    if (from === to + 1) return; // 已经紧邻其后，无需再动
    node.widgets.splice(from, 1);
    node.widgets.splice(node.widgets.indexOf(target) + 1, 0, widget);
}

// 仅在「加载 / configure」阶段调用：用保存的 widgets_values 校正一次。
// 目的只是兼容旧版索引错位的工作流；绝不能放进 syncResolutionPresetUI，
// 否则每次点按钮都会被旧值覆盖回去（v0.36 修复的核心问题）。
function applySavedValues(node) {
    const byName = getWidgetsByName(node);
    const saved = node.widgets_values ? [...node.widgets_values] : null;
    if (!saved || saved.length < WIDGET_NAMES.length) return false;
    let changed = false;
    // 必须两段式：先把包括 enforce_multiple_of_8 在内的所有非宽高控件回填完，
    // 再回填宽高。normDim 读取的是开关控件的「当前值」，如果宽高先处理，
    // 开关还是后端默认的 true，保存的 900 会被抹成 904（实测踩过）。
    WIDGET_NAMES.forEach((name, i) => {
        if (name === "custom_width" || name === "custom_height") return;
        const w = byName[name];
        if (!w) return;
        if (w.value !== saved[i]) {
            w.value = saved[i];
            changed = true;
        }
    });
    WIDGET_NAMES.forEach((name, i) => {
        if (name !== "custom_width" && name !== "custom_height") return;
        const w = byName[name];
        if (!w) return;
        const v = normDim(node, saved[i]);
        if (w.value !== v) {
            w.value = v;
            changed = true;
        }
    });
    if (changed) rebuildWidgetsValues(node);
    return changed;
}

function redraw(node) {
    try {
        node.setSize(node.computeSize());
        if (app.canvas) app.canvas.setDirty(true, true);
    } catch (e) {
        console.warn("[ResolutionPresets] redraw failed", e);
    }
}

// 9:16 / 3:4 / 2:3 / 4:5 只为兼容旧工作流保留，当前 RATIO_OPTIONS 里已不提供
// （方向统一由 portrait 强制，见 effectiveRatio）
const RATIOS = {
    "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "3:4": 3 / 4,
    "3:2": 3 / 2, "2:3": 2 / 3, "1:1": 1, "21:9": 21 / 9,
    "4:5": 4 / 5, "5:4": 5 / 4, "6:5": 6 / 5,
};

function effectiveRatio(ratioName, isPortrait) {
    const base = RATIOS[ratioName];
    if (base == null) return 1;
    const nativeLandscape = base >= 1;
    if (isPortrait && nativeLandscape) return 1 / base;
    if (!isPortrait && !nativeLandscape) return 1 / base;
    return base;
}

// 锁定宽高比联动：现取控件，避免持有失效引用
function applyRatio(node, source) {
    const byName = getWidgetsByName(node);
    const ratio = byName["ratio"];
    const portrait = byName["portrait"];
    const ratio_lock = byName["ratio_lock"];
    const custom_width = byName["custom_width"];
    const custom_height = byName["custom_height"];
    if (!ratio || !portrait || !ratio_lock || !custom_width || !custom_height) return;
    if (!ratio_lock.value) return;

    const r = effectiveRatio(ratio.value, !!portrait.value);
    if (source === "custom_width") {
        custom_height.value = normDim(node, custom_width.value / r);
    } else {
        custom_width.value = normDim(node, custom_height.value * r);
    }

    rebuildWidgetsValues(node);
}

function setupResolutionPresets(node) {
    if (node._resolutionPresetsReady) {
        syncResolutionPresetUI(node);
        return;
    }

    try {
        const widgets = node.widgets || [];
        const byName = getWidgetsByName(node);
        const allReady = WIDGET_NAMES.every((n) => byName[n]);

        if (widgets.length < WIDGET_NAMES.length || !allReady) {
            // 新前端的控件是异步初始化的，可能还没就绪，稍后重试
            const tries = (node._resolutionPresetsTries || 0) + 1;
            node._resolutionPresetsTries = tries;
            if (tries <= 20) {
                // 不逐次打 warn：控件异步初始化时这里会跑很多轮，刷屏
                setTimeout(() => {
                    if (!node._resolutionPresetsReady) setupResolutionPresets(node);
                }, 100);
            } else {
                console.error("[ResolutionPresets] give up, widgets:",
                    widgets.map((w) => w && w.name).join(", "));
            }
            return;
        }

        // 节点标题「分辨率预设」由 NODE_DISPLAY_NAME_MAPPINGS 提供，
        // 输出端口「宽度 / 高度」由 RETURN_NAMES 提供，二者后端已给中文，
        // 这里不再重复设置（顺带避免在 setup 晚于 configure 完成时覆盖用户的自定义标题）。

        const preset = byName["preset"];
        const custom_width = byName["custom_width"];
        const custom_height = byName["custom_height"];
        const ratio = byName["ratio"];
        const enforce = byName["enforce_multiple_of_8"];
        const portrait = byName["portrait"];
        const custom_mode = byName["custom_mode"];
        const ratio_lock = byName["ratio_lock"];

        // 中文化：只改 label，绝不改 name
        if (preset) preset.label = "预设尺寸";
        if (custom_width) custom_width.label = "自定义宽度";
        if (custom_height) custom_height.label = "自定义高度";
        if (ratio) ratio.label = "宽高比";
        if (enforce) enforce.label = "强制 8 的倍数";
        if (portrait) portrait.label = "竖屏";
        if (custom_mode) custom_mode.label = "使用自定义分辨率";
        if (ratio_lock) ratio_lock.label = "锁定宽高比";

        // 隐藏三个状态布尔（name 仍为英文，值照常发给后端）
        setWidgetHidden(portrait, true);
        setWidgetHidden(custom_mode, true);
        setWidgetHidden(ratio_lock, true);

        // 加载时用保存值校正一次（兼容旧版错位工作流）
        applySavedValues(node);

        // 宽高联动回调。记录最后编辑的是哪一边，改「宽高比」时以它为基准，
        // 避免用户刚调过高度、一切换比例就被按宽度反推覆盖掉。
        custom_width.callback = () => {
            node._resolutionPresetsLastDim = "custom_width";
            applyRatio(node, "custom_width");
        };
        custom_height.callback = () => {
            node._resolutionPresetsLastDim = "custom_height";
            applyRatio(node, "custom_height");
        };
        ratio.callback = () => applyRatio(
            node,
            node._resolutionPresetsLastDim === "custom_height" ? "custom_height" : "custom_width"
        );

        // 中文按钮（追加到末尾，保持 serialize=false）
        const orientBtn = node.addWidget(
            "button",
            "横竖屏",
            null,
            () => {
                // 仅切换方向标志，绝不修改已填写的自定义宽高。
                // 实际横竖屏旋转由后端 portrait 参数统一强制，避免切换时覆盖用户输入。
                const w = getWidgetsByName(node)["portrait"];
                if (!w) return;
                w.value = !w.value;
                if (w.callback) w.callback(w.value);
                rebuildWidgetsValues(node);
                syncResolutionPresetUI(node);
                redraw(node);
            }
        );
        makeButtonNonSerializing(orientBtn);

        const modeBtn = node.addWidget(
            "button",
            "模式",
            null,
            () => {
                const w = getWidgetsByName(node)["custom_mode"];
                if (!w) return;
                w.value = !w.value;
                if (w.callback) w.callback(w.value);
                rebuildWidgetsValues(node);
                syncResolutionPresetUI(node);
                redraw(node);
            }
        );
        makeButtonNonSerializing(modeBtn);

        const ratioLockBtn = node.addWidget(
            "button",
            "宽高比",
            null,
            () => {
                const w = getWidgetsByName(node)["ratio_lock"];
                if (!w) return;
                w.value = !w.value;
                if (w.callback) w.callback(w.value);
                rebuildWidgetsValues(node);
                syncResolutionPresetUI(node);
                if (w.value) applyRatio(node, "custom_width");
                redraw(node);
            }
        );
        makeButtonNonSerializing(ratioLockBtn);

        // 把「宽高比」选择框挪到「宽高比：锁定 / 自由」按钮的正下方，
        // 让它紧跟着开关出现，而不是孤零零地留在上面。
        moveWidgetAfter(node, ratio, ratioLockBtn);

        node._resolutionPresetsReady = true;
        node._resolutionPresetsButtons = { orientBtn, modeBtn, ratioLockBtn };

        // 工作流加载完成后（configure）再校正 + 刷新一次，
        // 防止按钮文字 / 显隐与保存状态不一致
        if (!node._resolutionPresetsConfigureHooked) {
            node._resolutionPresetsConfigureHooked = true;
            const origConfigure = node.onConfigure;
            node.onConfigure = function (o) {
                const r = origConfigure ? origConfigure.apply(this, arguments) : undefined;
                applySavedValues(node);
                syncResolutionPresetUI(node);
                return r;
            };
        }

        // 保存前同步 widgets_values，避免重启后状态回到默认
        if (!node._resolutionPresetsSerializeHooked) {
            node._resolutionPresetsSerializeHooked = true;
            const origSerialize = node.onSerialize;
            node.onSerialize = function (o) {
                const r = origSerialize ? origSerialize.apply(this, arguments) : undefined;
                rebuildWidgetsValues(node);
                // litegraph 的 serialize() 在调用本钩子「之前」就已按显示顺序
                // 生成了 o.widgets_values（按钮占位 null、ratio 被挪到末尾）。
                // 只更新 node.widgets_values 不够，必须用固定兼容顺序覆盖 o，
                // 否则保存的工作流下次载入会整体错位（实测 11 项含 null）。
                if (o) o.widgets_values = node.widgets_values;
                return r;
            };
        }

        syncResolutionPresetUI(node);
        redraw(node);
    } catch (e) {
        console.error("[ResolutionPresets] setup failed", e);
    }
}

// 只负责「按当前 widget.value 刷新表现」，绝不再回填保存值
function syncResolutionPresetUI(node) {
    if (!node._resolutionPresetsReady) return;
    try {
        const byName = getWidgetsByName(node);
        const portrait = byName["portrait"];
        const custom_mode = byName["custom_mode"];
        const preset = byName["preset"];
        const custom_width = byName["custom_width"];
        const custom_height = byName["custom_height"];
        const ratio_lock = byName["ratio_lock"];
        const ratio = byName["ratio"];
        const btns = node._resolutionPresetsButtons || {};

        // 规范化宽高（是否对齐到 8 取决于「强制 8 的倍数」开关）
        if (custom_width) custom_width.value = normDim(node, custom_width.value);
        if (custom_height) custom_height.value = normDim(node, custom_height.value);

        // 按钮文字跟随状态
        if (btns.orientBtn) {
            btns.orientBtn.name = portrait && portrait.value ? "横竖屏：竖屏" : "横竖屏：横屏";
        }
        if (btns.modeBtn) {
            btns.modeBtn.name = custom_mode && custom_mode.value ? "模式：自定义" : "模式：预设";
        }
        if (btns.ratioLockBtn) {
            btns.ratioLockBtn.name = ratio_lock && ratio_lock.value ? "宽高比：锁定" : "宽高比：自由";
        }

        // 显隐控制
        const isCustom = !!(custom_mode && custom_mode.value);
        const isLocked = isCustom && !!(ratio_lock && ratio_lock.value);
        setWidgetHidden(ratio, !isLocked);
        if (btns.ratioLockBtn) setWidgetHidden(btns.ratioLockBtn, !isCustom);
        setWidgetHidden(preset, isCustom);
        setWidgetHidden(custom_width, !isCustom);
        setWidgetHidden(custom_height, !isCustom);

        // 同步 widgets_values（按 WIDGET_NAMES 固定顺序，与显示顺序无关）
        rebuildWidgetsValues(node);
    } catch (e) {
        console.error("[ResolutionPresets] sync UI failed", e);
    }
}

app.registerExtension({
    name: "ComfyUI.ResolutionPresets",
    // 只保留这一条入口。原先还同时注册了 nodeCreated，两者会各自调用一次
    // setupResolutionPresets；虽然被 _resolutionPresetsReady 守卫兜住没出事，
    // 但控件未就绪时会拉起两条并行的重试链，纯属浪费。
    //
    // v0.39：ResolutionPresetsLatent（Latent 版）与 INT 版的 INPUT_TYPES 完全一致，
    // 直接复用同一套 UI / 序列化逻辑，只是后端多输出一个 LATENT 端口。
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "ResolutionPresets" && nodeData.name !== "ResolutionPresetsLatent") return;
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            setupResolutionPresets(this);
            return r;
        };
    },
});
