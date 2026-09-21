import math

import torch

# ComfyUI-ResolutionPresets
# 常用出图尺寸预设 + 一键横竖屏按钮 + 自定义分辨率（含锁定宽高比）
# 两个节点：
#   - ResolutionPresets       输出 INT 宽、INT 高，连到 Empty Latent Image / 任意需要宽高的节点
#   - ResolutionPresetsLatent 直接输出 LATENT（同 EasySize-Latent 的做法），省去外接空潜空间节点
#
# 前端扩展 js/resolution_presets.js 负责：
#   - 把状态开关（portrait / custom_mode / ratio_lock）隐藏，并用中文按钮控制
#   - 把其它控件标签、输出端口名改成中文
#   - 预设 / 自定义按当前模式互斥显隐（非激活的一方隐藏，避免后端忽略的死控件）
#   - 锁定比例时，改任意一边自动计算另一边（对齐到 8 的倍数）

class ResolutionPresets:
    # 预设只存一组「基准尺寸」（统一 width >= height，不含方向信息，名字里也不再带横/竖屏）。
    # 最终出图方向由 portrait 参数统一强制（见 get_resolution）：同一预设在竖屏模式下会自动
    # 旋转为 height >= width（如 1920×1080 → 1080×1920），因此无需在预设里重复列竖屏项。
    # 数值均已是 8 的倍数，避免潜在空间尺寸报错。
    PRESETS = {
        # —— SD1.5（原生 512 基准）——
        "SD1.5 512×512": (512, 512),        # 1:1
        "SD1.5 640×512": (640, 512),        # 5:4
        "SD1.5 768×512": (768, 512),        # 3:2
        "SD1.5 768×640": (768, 640),        # 6:5
        # —— SDXL 原生（长边约 1024）——
        "SDXL 1024×1024": (1024, 1024),     # 1:1
        "SDXL 1152×896": (1152, 896),       # 9:7
        "SDXL 1216×832": (1216, 832),       # ≈3:2
        "SDXL 1344×768": (1344, 768),       # 7:4
        "SDXL 1536×640": (1536, 640),       # 12:5 超宽
        # —— 照片 / 视频 16:9 ——
        "HD 1280×720": (1280, 720),
        "FHD 1920×1080": (1920, 1080),
        "2K 2560×1440": (2560, 1440),
        "4K 3840×2160": (3840, 2160),
        # —— 超宽屏 21:9 ——
        "21:9 2560×1080": (2560, 1080),
        "21:9 3440×1440": (3440, 1440),
        # —— 其它常用比例（横版）——
        "4:3 1600×1200": (1600, 1200),
        "3:2 1920×1280": (1920, 1280),
        "5:4 1280×1024": (1280, 1024),
    }
    PRESET_NAMES = list(PRESETS.keys())

    # 旧版本删除过带「横屏 / 竖屏」字样的预设项，历史工作流里可能仍存着这些名字，
    # 取不到时回退到这个值，避免整节点 KeyError。
    DEFAULT_PRESET = "SDXL 1024×1024"

    # 只保留每个比例的一个基准（横版）项：方向已由 portrait（横竖屏按钮）统一强制，
    # 前端 effectiveRatio 会按当前方向自动翻转（如 16:9 竖屏 → 9:16），成对的方向项完全等价、属冗余。
    # 旧的 9:16/3:4/2:3/4:5 等值仍可由前端 RATIOS 映射表正确解析（兼容旧工作流）。
    # 「6:5」对应预设里的 SD1.5 768×640，之前漏了
    RATIO_OPTIONS = ["16:9", "4:3", "3:2", "1:1", "21:9", "5:4", "6:5"]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "portrait": ("BOOLEAN", {"default": False}),
                "custom_mode": ("BOOLEAN", {"default": False}),
                "preset": (cls.PRESET_NAMES, {"default": cls.DEFAULT_PRESET}),
                "custom_width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "custom_height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 8}),
                "ratio_lock": ("BOOLEAN", {"default": False}),
                "ratio": (cls.RATIO_OPTIONS, {"default": "16:9"}),
                "enforce_multiple_of_8": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("宽度", "高度")
    FUNCTION = "get_resolution"
    CATEGORY = "分辨率"

    @classmethod
    def _resolve(cls, portrait, custom_mode, preset, custom_width, custom_height,
                 ratio_lock, ratio, enforce_multiple_of_8):
        """共用分辨率计算：两个节点（INT 版 / Latent 版）都走这里，保证行为一致。"""
        if custom_mode:
            w, h = int(custom_width), int(custom_height)
        else:
            if preset not in cls.PRESETS:
                print(f"[ResolutionPresets] 未知预设 '{preset}'，"
                      f"回退到 '{cls.DEFAULT_PRESET}'")
                preset = cls.DEFAULT_PRESET
            w, h = cls.PRESETS[preset]

        # 方向为唯一权威：横屏必须 width >= height，竖屏必须 height >= width。
        # 这样无论预设/自定义输入是什么朝向，选横屏就一定出横屏图，选竖屏就一定出竖屏图。
        if portrait:
            if w > h:
                w, h = h, w
        else:
            if h > w:
                w, h = h, w

        # 可选：强制 8 的倍数（潜在空间要求）
        #
        # 取整规则必须与前端 js/resolution_presets.js 的 clamp8() 保持一致。
        # Python 内置 round() 是银行家舍入（round(112.5) == 112 → 900 变 896），
        # 而 JS Math.round() 是四舍五入（112.5 → 113 → 900 变 904）。
        # 二者混用会导致「UI 显示 904、实际出图 896」，这里显式用 floor(x + 0.5)。
        if enforce_multiple_of_8:
            w = max(64, math.floor(w / 8 + 0.5) * 8)
            h = max(64, math.floor(h / 8 + 0.5) * 8)
        else:
            # 不对齐到 8 时仍保留下界，与前端 clampFree() 的 min 64 一致
            w = max(64, w)
            h = max(64, h)

        return int(w), int(h)

    def get_resolution(self, portrait, custom_mode, preset, custom_width, custom_height,
                       ratio_lock, ratio, enforce_multiple_of_8):
        return self._resolve(portrait, custom_mode, preset, custom_width, custom_height,
                             ratio_lock, ratio, enforce_multiple_of_8)


class ResolutionPresetsLatent(ResolutionPresets):
    """Latent 版：输入与「分辨率预设」完全一致（共用同一套前端 UI），
    但直接输出空潜空间 LATENT，等价于 分辨率预设 → Empty Latent Image 两连。
    参照 ComfyUI_EasySize 的 EasySizeSimpleLatent：latent 形状 [1, 4, h//8, w//8]。

    注意：无论「强制 8 的倍数」开关是否打开，这里都按 8 对齐——
    潜在空间本质要求 h/8、w/8 为整数，关掉开关只影响 INT 版的透传值，
    Latent 版若不对齐会出现「声明的宽高与实际解码尺寸不符」。
    """

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("Latent",)
    FUNCTION = "get_latent"
    CATEGORY = "分辨率"

    def get_latent(self, portrait, custom_mode, preset, custom_width, custom_height,
                   ratio_lock, ratio, enforce_multiple_of_8):
        w, h = self._resolve(portrait, custom_mode, preset, custom_width, custom_height,
                             ratio_lock, ratio, enforce_multiple_of_8)
        # 潜在空间对齐（见类注释）：这里独立于 enforce_multiple_of_8 强制执行
        w = max(64, math.floor(w / 8 + 0.5) * 8)
        h = max(64, math.floor(h / 8 + 0.5) * 8)
        latent = torch.zeros([1, 4, h // 8, w // 8])
        return ({"samples": latent},)


# ComfyUI 节点注册
NODE_CLASS_MAPPINGS = {
    "ResolutionPresets": ResolutionPresets,
    "ResolutionPresetsLatent": ResolutionPresetsLatent,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ResolutionPresets": "分辨率预设",
    "ResolutionPresetsLatent": "分辨率预设-Latent",
}
