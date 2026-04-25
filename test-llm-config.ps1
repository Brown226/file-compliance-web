# LLM 配置自动化测试脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "LLM 配置保存与加载测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 登录获取 Token
Write-Host "[1/4] 正在登录..." -ForegroundColor Yellow
$loginBody = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
    $token = $loginResponse.data.token
    Write-Host "✓ 登录成功，Token: $($token.Substring(0, 20))..." -ForegroundColor Green
} catch {
    Write-Host "✗ 登录失败: $_" -ForegroundColor Red
    exit 1
}

# 2. 保存 LLM 配置
Write-Host ""
Write-Host "[2/4] 正在保存 LLM 配置..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$saveBody = @{
    value = @{
        serviceType = "custom"
        apiKey = "test-api-key-123456"
        apiBaseUrl = "https://api.test.com/v1"
        modelName = "test-model"
        maxTokens = 4096
        temperature = 0.5
        timeout = 120
        enabled = $true
    }
} | ConvertTo-Json -Depth 10

try {
    $saveResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/system-config/llm_chat_model" -Method Put -Headers $headers -Body $saveBody
    Write-Host "✓ 配置保存成功" -ForegroundColor Green
    Write-Host "  ID: $($saveResponse.data.id)" -ForegroundColor Gray
} catch {
    Write-Host "✗ 保存失败: $_" -ForegroundColor Red
    Write-Host "  详情: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    exit 1
}

# 3. 等待一下确保数据库写入完成
Start-Sleep -Seconds 1

# 4. 读取配置验证
Write-Host ""
Write-Host "[3/4] 正在读取配置验证..." -ForegroundColor Yellow
try {
    $getResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/system-config/llm_chat_model" -Method Get -Headers $headers
    $savedValue = $getResponse.data.value
    
    Write-Host "✓ 配置读取成功" -ForegroundColor Green
    
    # 解析 JSON 字符串
    if ($savedValue -is [string]) {
        $parsedConfig = $savedValue | ConvertFrom-Json
        Write-Host ""
        Write-Host "  保存的配置内容:" -ForegroundColor Cyan
        Write-Host "  - serviceType: $($parsedConfig.serviceType)" -ForegroundColor Gray
        Write-Host "  - apiKey: $($parsedConfig.apiKey)" -ForegroundColor Gray
        Write-Host "  - apiBaseUrl: $($parsedConfig.apiBaseUrl)" -ForegroundColor Gray
        Write-Host "  - modelName: $($parsedConfig.modelName)" -ForegroundColor Gray
        
        # 验证关键字段
        $isMatch = ($parsedConfig.apiKey -eq "test-api-key-123456") -and 
                   ($parsedConfig.apiBaseUrl -eq "https://api.test.com/v1") -and
                   ($parsedConfig.modelName -eq "test-model")
        
        if ($isMatch) {
            Write-Host ""
            Write-Host "✓ 配置验证通过！所有字段正确保存" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "✗ 配置验证失败：字段不匹配" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ 返回的 value 不是字符串类型" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ 读取失败: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "现在请在浏览器中：" -ForegroundColor Yellow
Write-Host "1. 访问 http://localhost:80" -ForegroundColor White
Write-Host "2. 清除浏览器缓存 (Ctrl+Shift+Delete)" -ForegroundColor White
Write-Host "3. 登录系统 (admin / admin123)" -ForegroundColor White
Write-Host "4. 进入 LLM 配置页面" -ForegroundColor White
Write-Host "5. 刷新页面，检查配置是否保留" -ForegroundColor White
Write-Host ""
