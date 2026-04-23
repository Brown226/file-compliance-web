using Normative.Client;
using Normative.Context;
using Normative.Core;
using Normative.Model;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Normative
{
    public partial class NormativeStandard : UserControl
    {
        public NormativeStandard()
        {
            InitializeComponent();
            if (NormativeDataHelper.Instance.CurrentUserModel.RoleCode.Contains("M"))
            {
                btn_import.Visible = true;
                btn_upload.Visible = true;
                btn_del.Visible = true;
            }
            else
            {
                btn_import.Visible = false;
                btn_upload.Visible = false;
                btn_del.Visible = false;
            }
            gdv_standard.AutoGenerateColumns = false;
            gdv_standard.DataSource = null;            
        }

        bool isimport = false;
        List<StandardModel> StandardModels = new List<StandardModel>();

        private void btn_search_Click(object sender, EventArgs e)
        {
            try
            {
                string checkvererror = UIMarkHelper.CheckVersion();
                if (!string.IsNullOrEmpty(checkvererror))
                {
                    MessageBox.Show(checkvererror);
                    return;
                }
                pal_btn.Enabled = false;
                refresh();
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_btn.Enabled = true;
            }
        }

        private void btn_import_Click(object sender, EventArgs e)
        {
            try
            {
                pal_btn.Enabled = false;
                OpenFileDialog of = new OpenFileDialog();
                of.Title = "导入";
                of.Filter = "xlsx文件(*.xlsx)|*.xlsx|xls文件(*.xls)|*.xls";
                DialogResult dr = of.ShowDialog();
                if (dr != DialogResult.OK)
                {
                    return;
                }
                isimport = true;
                StandardModels = new List<StandardModel>();
                gdv_standard.DataSource = null;
                string filename = of.FileName;
                StandardModels = NormativeHelper.GetStandard(filename);
                if (StandardModels != null && StandardModels.Count > 0)
                {
                    gdv_standard.DataSource = StandardModels;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_btn.Enabled = true;
            }
        }

        private void btn_upload_Click(object sender, EventArgs e)
        {
            try
            {
                string checkvererror = UIMarkHelper.CheckVersion();
                if (!string.IsNullOrEmpty(checkvererror))
                {
                    MessageBox.Show(checkvererror);
                    return;
                }
                pal_btn.Enabled = false;
                if (!isimport)
                {
                    MessageBox.Show("请先导入数据");
                    return;
                }
                if (StandardModels == null || StandardModels.Count == 0)
                {
                    return;
                }
                List<StandardModel> UpStandardModels = new List<StandardModel>();
                var currentmodels = NormativeDataHelper.Instance.StandardInfos;
                foreach (var model in StandardModels)
                {
                    if (string.IsNullOrEmpty(model.StandardNo))
                    {
                        model.MessInfo = "标准编号缺失";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    if (string.IsNullOrEmpty(model.StandardName))
                    {
                        model.MessInfo = "标准名称缺失";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    if (model.ImplementDate == DateTime.MinValue)
                    {
                        model.MessInfo = "实施日期缺失";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    if (currentmodels.Exists(t => t.StandardNo == model.StandardNo))
                    {
                        model.MessInfo = "标准编号已存在";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    if (currentmodels.Exists(t => t.StandardName == model.StandardName))
                    {
                        model.MessInfo = "标准名称已存在";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    var qNo = UpStandardModels.FirstOrDefault(t => t.StandardNo == model.StandardNo);
                    if (qNo != null)
                    {
                        qNo.MessInfo = "标准编号重复";
                        UpStandardModels.Remove(qNo);
                        model.MessInfo = "标准编号重复";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    var qname = UpStandardModels.FirstOrDefault(t => t.StandardName == model.StandardName);
                    if (qname != null)
                    {
                        qname.MessInfo = "标准名称重复";
                        UpStandardModels.Remove(qname);
                        model.MessInfo = "标准名称重复";
                        CommHelper.refreshgrid(gdv_standard, model.Index);
                        continue;
                    }
                    model.CreateUser = AppContextInfo.Instance.CurrentUser;
                    UpStandardModels.Add(model);
                }

                if (UpStandardModels.Count == 0)
                {
                    MessageBox.Show("不存在可上传的数据");
                    return;
                }

                DialogResult dr = MessageBox.Show($"您确定要上传这些标准（{UpStandardModels.Count}）吗？", "消息提示", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (dr != DialogResult.OK)
                {
                    return;
                }

                bool bl = NormativeClient.Instance.InsertSatndard(UpStandardModels);
                if (bl)
                {
                    isimport = false;
                    NormativeDataHelper.Instance.ClearStandardInfos();
                    var models = NormativeDataHelper.Instance.StandardInfos;
                    MessageBox.Show("保存成功");
                }
                else
                {
                    MessageBox.Show("存储失败");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_btn.Enabled = true;
            }
        }

        private void btn_del_Click(object sender, EventArgs e)
        {
            try
            {
                string checkvererror = UIMarkHelper.CheckVersion();
                if (!string.IsNullOrEmpty(checkvererror))
                {
                    MessageBox.Show(checkvererror);
                    return;
                }
                if (isimport)
                {
                    MessageBox.Show("请先获取数据");
                    return;
                }
                pal_btn.Enabled = false;
                if (gdv_standard.SelectedRows == null || gdv_standard.SelectedRows.Count == 0)
                {
                    MessageBox.Show("请先选择需要删除的标准");
                    return;
                }
                DialogResult dr = MessageBox.Show("您确定要删除这些标准吗？", "消息提示", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
                if (dr != DialogResult.OK)
                {
                    return;
                }
                List<DataGridViewRow> DataGridViewRowList = new List<DataGridViewRow>();
                foreach (DataGridViewRow dgvrow in this.gdv_standard.SelectedRows)
                {
                    DataGridViewRowList.Add(dgvrow);
                }
                DataGridViewRowList.Sort((a, b) => a.Index.CompareTo(b.Index));
                List<StandardModel> delmodels = new List<StandardModel>();
                foreach (DataGridViewRow dgvrow in DataGridViewRowList)
                {
                    int index = dgvrow.Index;
                    var modelitem = (StandardModel)dgvrow.DataBoundItem;
                    delmodels.Add(modelitem);
                }
                List<Guid> StandardOids = delmodels.Select(t => t.StandardOID).ToList();
                ApiResult res = NormativeClient.Instance.DelStandards(StandardOids);

                if (res == null)
                {
                    MessageBox.Show("删除出现异常");
                    return;
                }
                if (res.Code == 1)
                {
                    string messinfo = res.Msg;
                    if (string.IsNullOrEmpty(messinfo))
                    {
                        messinfo = "删除失败";
                    }
                    MessageBox.Show(messinfo);
                    return;
                }
                else
                {
                    refresh();
                    MessageBox.Show("删除成功");
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString());
            }
            finally
            {
                pal_btn.Enabled = true;
            }
        }

        private void refresh()
        {
            isimport = false;
            string StandNo = txt_StandNo.Text;
            string StandName = txt_StandName.Text;
            gdv_standard.DataSource = null;
            NormativeDataHelper.Instance.ClearStandardInfos();
            StandardModels = NormativeDataHelper.Instance.StandardInfos;
            if (!string.IsNullOrEmpty(StandNo))
            {
                StandardModels = StandardModels.FindAll(t => t.StandardNo.Contains(StandNo));
            }
            if (!string.IsNullOrEmpty(StandName))
            {
                StandardModels = StandardModels.FindAll(t => t.StandardName.Contains(StandName));
            }
            if (StandardModels != null && StandardModels.Count > 0)
            {
                gdv_standard.DataSource = StandardModels;
            }
        }

        #region 列表操作
        private void gdv_model_RowPostPaint(object sender, DataGridViewRowPostPaintEventArgs e)
        {
            try
            {
                var grid = sender as DataGridView;
                var rowidx = (e.RowIndex + 1).ToString();
                var centerformat = new StringFormat()
                {
                    Alignment = StringAlignment.Center,
                    LineAlignment = StringAlignment.Center
                };
                var headerbounds = new Rectangle(e.RowBounds.Left, e.RowBounds.Top, grid.RowHeadersWidth, e.RowBounds.Height);
                e.Graphics.DrawString(rowidx, this.Font, SystemBrushes.ControlText, headerbounds, centerformat);
            }
            catch (Exception)
            {

            }
        }

        #endregion

    }
}
