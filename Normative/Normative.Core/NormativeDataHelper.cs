using Normative.Client;
using Normative.Model;
using PaddleOCRSharp;
using System.Collections.Generic;

namespace Normative.Core
{
    public class NormativeDataHelper
    {
        private NormativeDataHelper()
        {
        }

        private static NormativeDataHelper instance;
        public static NormativeDataHelper Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new NormativeDataHelper();
                }

                return instance;
            }
        }

        private List<StandardModel> standardInfos;
        public List<StandardModel> StandardInfos
        {
            get
            {
                if (this.standardInfos == null || this.standardInfos.Count == 0)
                {
                    this.standardInfos = NormativeClient.Instance.GetStandardModels();
                }
                return this.standardInfos;
            }
        }

        public void ClearStandardInfos()
        {
            this.standardInfos = new List<StandardModel>();
        }

        public List<StandardModel> SelfStandardInfos = new List<StandardModel>();

        private UserModel currentUserModel;
        public UserModel CurrentUserModel
        {
            get
            {
                if (this.currentUserModel == null)
                {
                    currentUserModel = NormativeClient.Instance.GetUserModel();
                }
                return this.currentUserModel;
            }
        }

        private List<EnumModel> roleEnums;
        public List<EnumModel> RoleEnums
        {
            get
            {
                if (roleEnums == null || this.roleEnums.Count == 0)
                {
                    this.roleEnums = NormativeClient.Instance.GetRoleEnumModels("");
                }
                return this.roleEnums;
            }
        }

        private PaddleOCREngine ocrengine;
        public PaddleOCREngine OcrEngine
        {
            get
            {
                if (ocrengine == null)
                {
                    OCRModelConfig config = new OCRModelConfig();
                    string text = @"\\10.102.2.77\Evars\E3D\PDMSTOOLS\Normative\inference";
                    config.det_infer = text + "\\ch_PP-OCRv3_det_infer";
                    config.cls_infer = text + "\\ch_ppocr_mobile_v2.0_cls_infer";
                    config.rec_infer = text + "\\ch_PP-OCRv3_rec_infer";
                    config.keys = text + "\\ppocr_keys.txt";
                    OCRParameter oCRParameter = new OCRParameter();
                    ocrengine = new PaddleOCREngine(config, oCRParameter);
                }
                return ocrengine;
            }
        }

        public string CurrentPubSoftVersion
        {
            get
            {
                return NormativeClient.Instance.GetCurrentPubVersion();
            }
        }

    }
}
