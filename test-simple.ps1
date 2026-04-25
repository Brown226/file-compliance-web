Write-Host "=== LLM Config Test ===" -ForegroundColor Cyan

# Login
$login = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" -Method Post -Body '{"username":"admin","password":"admin123"}' -ContentType "application/json"
$token = $login.data.token
Write-Host "Token: $($token.Substring(0,20))..." -ForegroundColor Green

# Save config
$headers = @{"Authorization"="Bearer $token"; "Content-Type"="application/json"}
$body = '{"value":{"serviceType":"custom","apiKey":"test-key","apiBaseUrl":"https://test.com/v1","modelName":"test-model","maxTokens":4096,"temperature":0.5,"timeout":120,"enabled":true}}'
$result = Invoke-RestMethod -Uri "http://localhost:3000/api/system-config/llm_chat_model" -Method Put -Headers $headers -Body $body
Write-Host "Saved: $($result.message)" -ForegroundColor Green

# Get config
$config = Invoke-RestMethod -Uri "http://localhost:3000/api/system-config/llm_chat_model" -Method Get -Headers $headers
Write-Host "Value type: $($config.data.value.GetType().Name)" -ForegroundColor Yellow
Write-Host "Value: $($config.data.value)" -ForegroundColor Gray

# Parse if string
if ($config.data.value -is [string]) {
    $parsed = $config.data.value | ConvertFrom-Json
    Write-Host "Parsed modelName: $($parsed.modelName)" -ForegroundColor Green
    
    if ($parsed.modelName -eq "test-model") {
        Write-Host "SUCCESS: Config saved and loaded correctly!" -ForegroundColor Green
    } else {
        Write-Host "FAIL: Model name mismatch" -ForegroundColor Red
    }
}
