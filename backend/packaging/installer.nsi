; Debate Engine 0.1.0 NSIS 安装脚本
; 编译：makensis installer.nsi → release\DebateEngine-0.1.0-Setup.exe
; 规则：默认只打包 NSIS 安装包（单文件），参照 Software packaging.md

Unicode true
!include "MUI2.nsh"
!include "WinMessages.nsh"

!define APP_NAME "Debate Engine"
!define APP_ID "DebateEngine"
!define APP_VERSION "0.1.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "..\..\release\DebateEngine-${APP_VERSION}-Setup.exe"
RequestExecutionLevel user
SetCompressor lzma

; ---------- 首次默认 C 盘用户目录；装过之后自动读注册表记住上次路径 ----------
InstallDir "$LOCALAPPDATA\Programs\DebateEngine"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"

; ---------- 页面流：欢迎 → 自定义目录 → 选桌面快捷方式 → 安装 ----------
ShowInstDetails show
ShowUnInstDetails show
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY ; 用户改路径就记在这里
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; ---------- 字符串替换函数（PATH 清理用，NSIS Wiki 标准实现） ----------
!define StrRep "!insertmacro StrRep"
!macro StrRep output string old new
    Push `${string}`
    Push `${old}`
    Push `${new}`
    !ifdef __UNINSTALL__
        Call un.StrRep
    !else
        Call StrRep
    !endif
    Pop ${output}
!macroend

!macro Func_StrRep un
    Function ${un}StrRep
        Exch $R2 ;new
        Exch 1
        Exch $R1 ;old
        Exch 2
        Exch $R0 ;string
        Push $R3
        Push $R4
        Push $R5
        Push $R6
        Push $R7
        Push $R8
        Push $R9

        StrCpy $R3 0
        StrLen $R4 $R1
        StrLen $R6 $R0
        StrLen $R9 $R2
        loop:
            StrCpy $R5 $R0 $R4 $R3
            StrCmp $R5 $R1 found
            StrCmp $R3 $R6 done
            IntOp $R3 $R3 + 1
            Goto loop
        found:
            StrCpy $R5 $R0 $R3
            IntOp $R8 $R3 + $R4
            StrCpy $R7 $R0 `` $R8
            StrCpy $R0 $R5$R2$R7
            StrLen $R6 $R0
            IntOp $R3 $R3 + $R9
            Goto loop
        done:

        Pop $R9
        Pop $R8
        Pop $R7
        Pop $R6
        Pop $R5
        Pop $R4
        Pop $R3
        Push $R0
        Push $R1
        Pop $R0
        Pop $R1
        Pop $R0
        Pop $R2
        Exch $R1
    FunctionEnd
!macroend
!insertmacro Func_StrRep ""
!insertmacro Func_StrRep "un."

; ---------- GUI 初始化无需自定义：InstallDir 首次默认 + InstallDirRegKey 记住上次，NSIS 自动处理 ----------

; ---------- 安装 ----------
Section "程序主体（必需）" SecMain
    SectionIn RO
    SetDetailsPrint both
    DetailPrint "正在复制程序文件..."
    ; 程序主体（PyInstaller onedir 输出）
    SetOutPath "$INSTDIR"
    File /r "..\dist\DebateEngine\*.*"

    ; 预置 Skill 文件（不覆盖用户已有知识库数据以外的部分）
    SetOutPath "$INSTDIR\knowledge_base\skills"
    File /r "..\..\knowledge_base\skills\*.*"

    ; 配置样例与说明
    SetOutPath "$INSTDIR"
    File "..\.env.example"
    File "/oname=使用说明.md" "安装说明.md"

    ; 卸载器 + 控制面板注册（HKCU，免管理员）
    DetailPrint "正在写入卸载信息与环境变量..."
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "lulutiyazejin"
    WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

    ; 写入用户 PATH（不重复追加）
    ReadRegStr $0 HKCU "Environment" "Path"
    ${StrRep} $1 "$0" "$INSTDIR" ""
    StrCmp $1 $0 0 path_done          ; 替换后无变化 = 尚未包含
    StrCmp $0 "" 0 path_append
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
    Goto path_notify
    path_append:
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
    path_notify:
    ; 广播超时压到 1 秒：无响应窗口逐个等 5 秒是安装 100% 后卡顿的主因
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=1000
    path_done:

    ; 开始菜单快捷方式
    CreateDirectory "$SMPROGRAMS\${APP_NAME}"
    CreateShortcut "$SMPROGRAMS\${APP_NAME}\DebateEngine 命令行.lnk" "$SYSDIR\cmd.exe" '/k "cd /d $INSTDIR"' "$INSTDIR\DebateEngine.exe" 0
    CreateShortcut "$SMPROGRAMS\${APP_NAME}\使用说明.lnk" "$INSTDIR\使用说明.md"
    CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "创建桌面快捷方式" DesktopShortcuts
    ; 直接双击 exe 会打印帮助后秒退（CLI 程序无参数行为），
    ; 故桌面快捷方式指向常驻命令行窗口，图标用主程序的
    CreateShortcut "$DESKTOP\Debate Engine.lnk" "$SYSDIR\cmd.exe" '/k "cd /d $INSTDIR && DebateEngine health"' "$INSTDIR\DebateEngine.exe" 0
SectionEnd

; ---------- 卸载（组件勾选页：程序必删，数据默认保留） ----------
Section "un.卸载程序本体" UnSecMain
    SectionIn RO
    ; 程序文件（2 万余个小文件，逐条打印避免看似卡死）
    DetailPrint "正在删除程序文件，数量较多请稍候..."
    RMDir /r "$INSTDIR\_internal"
    Delete "$INSTDIR\DebateEngine.exe"
    Delete "$INSTDIR\.env.example"
    Delete "$INSTDIR\使用说明.md"
    Delete "$INSTDIR\Uninstall.exe"

    ; 移除 PATH 条目（三种位置形态）
    DetailPrint "正在清理环境变量..."
    ReadRegStr $0 HKCU "Environment" "Path"
    ${StrRep} $1 "$0" ";$INSTDIR" ""
    ${StrRep} $1 "$1" "$INSTDIR;" ""
    ${StrRep} $1 "$1" "$INSTDIR" ""
    WriteRegExpandStr HKCU "Environment" "Path" "$1"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=1000

    ; 桌面快捷方式（卸载时一并清理）
    Delete "$DESKTOP\Debate Engine.lnk"

    ; 开始菜单 + 注册表
    RMDir /r "$SMPROGRAMS\${APP_NAME}"
    DeleteRegKey HKCU "${UNINST_KEY}"
    RMDir "$INSTDIR"
SectionEnd

Section /o "un.同时删除知识库数据（已导入文档、索引与日志）" UnSecData
    RMDir /r "$INSTDIR\knowledge_base"
    RMDir "$INSTDIR"
SectionEnd
