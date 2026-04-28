# 测试模式能力配置保存功能
# 使用 PowerShell 和 Invoke-RestMethod

$baseUrl = "http://localhost:3000/api"

Write-Host "`n=== 测试模式能力配置持久化 ===" -ForegroundColor Cyan

# 1. 登录获取 token
Write-Host "`n1. 登录获取 token..." -ForegroundColor Yellow
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

try {
    $loginResp = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
    $token = $loginResp.data.token
    Write-Host "✅ 登录成功，token: $($token.Substring(0, 20))..." -ForegroundColor Green
} catch {
    Write-Host "❌ 登录失败: $_" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 2. 获取当前配置
Write-Host "`n2. 获取当前模式配置..." -ForegroundColor Yellow
try {
    $currentConfig = Invoke-RestMethod -Uri "$baseUrl/tasks/mode-capabilities" -Method GET -Headers $headers
    Write-Host "✅ 当前配置:" -ForegroundColor Green
    $currentConfig.data | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ 获取配置失败: $_" -ForegroundColor Red
    exit 1
}

# 3. 修改配置（修改 TYPO_GRAMMAR 的 standardRef 为 true）
Write-Host "`n3. 修改配置（TYPO_GRAMMAR.standardRef = true）..." -ForegroundColor Yellow
$newConfig = $currentConfig.data.PSObject.Copy()
$newConfig.TYPO_GRAMMAR.standardRef = $true
$newConfig.TYPO_GRAMMAR.aiStrategy = "standard"

Write-Host "修改后的 TYPO_GRAMMAR 配置:" -ForegroundColor Cyan
$newConfig.TYPO_GRAMMAR | ConvertTo-Json | Write-Host

try {
    $saveResp = Invoke-RestMethod -Uri "$baseUrl/tasks/mode-capabilities" -Method PUT -Headers $headers -Body ($newConfig | ConvertTo-Json -Depth 5)
    Write-Host "✅ 保存响应: $($saveResp.message)" -ForegroundColor Green
} catch {
    Write-Host "❌ 保存失败: $_" -ForegroundColor Red
    Write-Host "错误详情: $($_.Exception.Response.StatusDescription)" -ForegroundColor Red
    exit 1
}

# 4. 重新获取配置验证
Write-Host "`n4. 重新获取配置验证..." -ForegroundColor Yellow
Start-Sleep -Seconds 1

try {
    $verifyConfig = Invoke-RestMethod -Uri "$baseUrl/tasks/mode-capabilities" -Method GET -Headers $headers
    Write-Host "✅ 验证配置:" -ForegroundColor Green
    $verifyConfig.data | ConvertTo-Json -Depth 5 | Write-Host
    
    # 检查修改是否生效
    if ($verifyConfig.data.TYPO_GRAMMAR.standardRef -eq $true) {
        Write-Host "`n🎉 配置持久化成功！TYPO_GRAMMAR.standardRef = $($verifyConfig.data.TYPO_GRAMMAR.standardRef)" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  配置未持久化！TYPO_GRAMMAR.standardRef = $($verifyConfig.data.TYPO_GRAMMAR.standardRef) (期望: True)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ 验证失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== 测试完成 ===" -ForegroundColor Cyan
