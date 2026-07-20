/**
 * RSA 密码加密工具
 * 使用与 RAGFlow 后端相同的 RSA 公钥进行密码加密
 */
import { Base64 } from 'js-base64';
import JSEncrypt from 'jsencrypt';

/**
 * RAGFlow 后端使用的 RSA 公钥
 * 注意：这个公钥需要与后端 conf/public.pem 文件中的公钥一致
 */
const RSA_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArq9XTUSeYr2+N1h3Afl/z8Dse/2yD0ZGrKwx+EEEcdsBLca9Ynmx3nIB5obmLlSfmskLpBo0UACBmB5rEjBp2Q2f3AG3Hjd4B+gNCG6BDaawuDlgANIhGnaTLrIqWrrcm4EMzJOnAOI1fgzJRsOOUEfaS318Eq9OVO3apEyCCt0lOQK6PuksduOjVxtltDav+guVAA068NrPYmRNabVKRNLJpL8w4D44sfth5RvZ3q9t+6RTArpEtc5sh5ChzvqPOzKGMXW83C95TxmXqpbK6olN4RevSfVjEAgCydH6HN6OhtOQEcnrU97r9H0iZOWwbw3pVrZiUkuRD1R56Wzs2wIDAQAB-----END PUBLIC KEY-----';

/**
 * 使用 RSA 公钥加密密码
 * @param password 原始密码
 * @returns 加密后的密码字符串
 */
export function encryptPassword(password: string): string {
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(RSA_PUBLIC_KEY);
  
  // 先将密码进行 Base64 编码，然后使用 RSA 加密
  const base64Password = Base64.encode(password);
  const encrypted = encryptor.encrypt(base64Password);
  
  if (!encrypted) {
    throw new Error('密码加密失败，请检查 RSA 公钥配置');
  }
  
  return encrypted;
}

