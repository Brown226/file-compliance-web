namespace Normative
{
    partial class NormativeStandard
    {
        /// <summary>
        /// 必需的设计器变量。
        /// </summary>
        private System.ComponentModel.IContainer components = null;

        /// <summary>
        /// 清理所有正在使用的资源。
        /// </summary>
        /// <param name="disposing">如果应释放托管资源，为 true；否则为 false。</param>
        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        #region Windows 窗体设计器生成的代码

        /// <summary>
        /// 设计器支持所需的方法 - 不要修改
        /// 使用代码编辑器修改此方法的内容。
        /// </summary>
        private void InitializeComponent()
        {
            this.gdv_standard = new System.Windows.Forms.DataGridView();
            this.PurchasingStatus = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardStatus = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardNo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.StandardName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.FileName = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.PublishDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.ImplementDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.RepealDate = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.MessInfo = new System.Windows.Forms.DataGridViewTextBoxColumn();
            this.btn_import = new System.Windows.Forms.Button();
            this.btn_search = new System.Windows.Forms.Button();
            this.btn_del = new System.Windows.Forms.Button();
            this.btn_upload = new System.Windows.Forms.Button();
            this.lab_StandNo = new System.Windows.Forms.Label();
            this.txt_StandNo = new System.Windows.Forms.TextBox();
            this.txt_StandName = new System.Windows.Forms.TextBox();
            this.lab_StandName = new System.Windows.Forms.Label();
            this.pal_btn = new System.Windows.Forms.Panel();
            ((System.ComponentModel.ISupportInitialize)(this.gdv_standard)).BeginInit();
            this.pal_btn.SuspendLayout();
            this.SuspendLayout();
            // 
            // gdv_standard
            // 
            this.gdv_standard.AllowUserToAddRows = false;
            this.gdv_standard.Anchor = ((System.Windows.Forms.AnchorStyles)((((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom) 
            | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.gdv_standard.BackgroundColor = System.Drawing.SystemColors.ButtonHighlight;
            this.gdv_standard.ColumnHeadersHeightSizeMode = System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode.AutoSize;
            this.gdv_standard.Columns.AddRange(new System.Windows.Forms.DataGridViewColumn[] {
            this.PurchasingStatus,
            this.StandardStatus,
            this.StandardNo,
            this.StandardName,
            this.FileName,
            this.PublishDate,
            this.ImplementDate,
            this.RepealDate,
            this.MessInfo});
            this.gdv_standard.Location = new System.Drawing.Point(5, 52);
            this.gdv_standard.Name = "gdv_standard";
            this.gdv_standard.RowTemplate.Height = 23;
            this.gdv_standard.Size = new System.Drawing.Size(801, 393);
            this.gdv_standard.TabIndex = 21;
            this.gdv_standard.RowPostPaint += new System.Windows.Forms.DataGridViewRowPostPaintEventHandler(this.gdv_model_RowPostPaint);
            // 
            // PurchasingStatus
            // 
            this.PurchasingStatus.DataPropertyName = "PurchasingStatus";
            this.PurchasingStatus.HeaderText = "采购状态";
            this.PurchasingStatus.Name = "PurchasingStatus";
            this.PurchasingStatus.ReadOnly = true;
            this.PurchasingStatus.Visible = false;
            this.PurchasingStatus.Width = 80;
            // 
            // StandardStatus
            // 
            this.StandardStatus.DataPropertyName = "StandardStatus";
            this.StandardStatus.HeaderText = "状态";
            this.StandardStatus.Name = "StandardStatus";
            this.StandardStatus.ReadOnly = true;
            this.StandardStatus.Visible = false;
            this.StandardStatus.Width = 60;
            // 
            // StandardNo
            // 
            this.StandardNo.DataPropertyName = "StandardNo";
            this.StandardNo.HeaderText = "标准编号";
            this.StandardNo.Name = "StandardNo";
            this.StandardNo.ReadOnly = true;
            this.StandardNo.Width = 150;
            // 
            // StandardName
            // 
            this.StandardName.DataPropertyName = "StandardName";
            this.StandardName.HeaderText = "标准名称";
            this.StandardName.Name = "StandardName";
            this.StandardName.ReadOnly = true;
            this.StandardName.Width = 350;
            // 
            // FileName
            // 
            this.FileName.DataPropertyName = "FileName";
            this.FileName.HeaderText = "文件名称";
            this.FileName.Name = "FileName";
            this.FileName.ReadOnly = true;
            this.FileName.Visible = false;
            this.FileName.Width = 80;
            // 
            // PublishDate
            // 
            this.PublishDate.DataPropertyName = "PublishDate";
            this.PublishDate.HeaderText = "发布日期";
            this.PublishDate.Name = "PublishDate";
            this.PublishDate.ReadOnly = true;
            this.PublishDate.Visible = false;
            this.PublishDate.Width = 80;
            // 
            // ImplementDate
            // 
            this.ImplementDate.DataPropertyName = "ImplementDate";
            this.ImplementDate.HeaderText = "实施日期";
            this.ImplementDate.Name = "ImplementDate";
            this.ImplementDate.ReadOnly = true;
            // 
            // RepealDate
            // 
            this.RepealDate.DataPropertyName = "RepealDate";
            this.RepealDate.HeaderText = "废止日期";
            this.RepealDate.Name = "RepealDate";
            this.RepealDate.ReadOnly = true;
            this.RepealDate.Visible = false;
            this.RepealDate.Width = 80;
            // 
            // MessInfo
            // 
            this.MessInfo.DataPropertyName = "MessInfo";
            this.MessInfo.HeaderText = "提示信息";
            this.MessInfo.Name = "MessInfo";
            this.MessInfo.ReadOnly = true;
            this.MessInfo.Width = 150;
            // 
            // btn_import
            // 
            this.btn_import.Location = new System.Drawing.Point(550, 8);
            this.btn_import.Name = "btn_import";
            this.btn_import.Size = new System.Drawing.Size(75, 30);
            this.btn_import.TabIndex = 25;
            this.btn_import.Text = "导入清单";
            this.btn_import.UseVisualStyleBackColor = true;
            this.btn_import.Click += new System.EventHandler(this.btn_import_Click);
            // 
            // btn_search
            // 
            this.btn_search.Location = new System.Drawing.Point(469, 8);
            this.btn_search.Name = "btn_search";
            this.btn_search.Size = new System.Drawing.Size(75, 30);
            this.btn_search.TabIndex = 24;
            this.btn_search.Text = "查询标准";
            this.btn_search.UseVisualStyleBackColor = true;
            this.btn_search.Click += new System.EventHandler(this.btn_search_Click);
            // 
            // btn_del
            // 
            this.btn_del.Location = new System.Drawing.Point(712, 8);
            this.btn_del.Name = "btn_del";
            this.btn_del.Size = new System.Drawing.Size(75, 30);
            this.btn_del.TabIndex = 26;
            this.btn_del.Text = "删除标准";
            this.btn_del.UseVisualStyleBackColor = true;
            this.btn_del.Click += new System.EventHandler(this.btn_del_Click);
            // 
            // btn_upload
            // 
            this.btn_upload.Location = new System.Drawing.Point(631, 8);
            this.btn_upload.Name = "btn_upload";
            this.btn_upload.Size = new System.Drawing.Size(75, 30);
            this.btn_upload.TabIndex = 27;
            this.btn_upload.Text = "上传标准";
            this.btn_upload.UseVisualStyleBackColor = true;
            this.btn_upload.Click += new System.EventHandler(this.btn_upload_Click);
            // 
            // lab_StandNo
            // 
            this.lab_StandNo.AutoSize = true;
            this.lab_StandNo.Location = new System.Drawing.Point(3, 17);
            this.lab_StandNo.Name = "lab_StandNo";
            this.lab_StandNo.Size = new System.Drawing.Size(53, 12);
            this.lab_StandNo.TabIndex = 28;
            this.lab_StandNo.Text = "标准编号";
            // 
            // txt_StandNo
            // 
            this.txt_StandNo.Location = new System.Drawing.Point(64, 13);
            this.txt_StandNo.Name = "txt_StandNo";
            this.txt_StandNo.Size = new System.Drawing.Size(160, 21);
            this.txt_StandNo.TabIndex = 29;
            // 
            // txt_StandName
            // 
            this.txt_StandName.Location = new System.Drawing.Point(300, 13);
            this.txt_StandName.Name = "txt_StandName";
            this.txt_StandName.Size = new System.Drawing.Size(160, 21);
            this.txt_StandName.TabIndex = 31;
            // 
            // lab_StandName
            // 
            this.lab_StandName.AutoSize = true;
            this.lab_StandName.Location = new System.Drawing.Point(239, 17);
            this.lab_StandName.Name = "lab_StandName";
            this.lab_StandName.Size = new System.Drawing.Size(53, 12);
            this.lab_StandName.TabIndex = 30;
            this.lab_StandName.Text = "标准名称";
            // 
            // pal_btn
            // 
            this.pal_btn.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.pal_btn.Controls.Add(this.lab_StandNo);
            this.pal_btn.Controls.Add(this.txt_StandName);
            this.pal_btn.Controls.Add(this.btn_search);
            this.pal_btn.Controls.Add(this.lab_StandName);
            this.pal_btn.Controls.Add(this.btn_import);
            this.pal_btn.Controls.Add(this.txt_StandNo);
            this.pal_btn.Controls.Add(this.btn_del);
            this.pal_btn.Controls.Add(this.btn_upload);
            this.pal_btn.Location = new System.Drawing.Point(5, 3);
            this.pal_btn.Name = "pal_btn";
            this.pal_btn.Size = new System.Drawing.Size(801, 43);
            this.pal_btn.TabIndex = 32;
            // 
            // NormativeStandard
            // 
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.Controls.Add(this.pal_btn);
            this.Controls.Add(this.gdv_standard);
            this.Name = "NormativeStandard";
            this.Size = new System.Drawing.Size(810, 450);
            ((System.ComponentModel.ISupportInitialize)(this.gdv_standard)).EndInit();
            this.pal_btn.ResumeLayout(false);
            this.pal_btn.PerformLayout();
            this.ResumeLayout(false);

        }

        #endregion

        private System.Windows.Forms.DataGridView gdv_standard;
        private System.Windows.Forms.Button btn_import;
        private System.Windows.Forms.Button btn_search;
        private System.Windows.Forms.Button btn_del;
        private System.Windows.Forms.Button btn_upload;
        private System.Windows.Forms.Label lab_StandNo;
        private System.Windows.Forms.TextBox txt_StandNo;
        private System.Windows.Forms.TextBox txt_StandName;
        private System.Windows.Forms.Label lab_StandName;
        private System.Windows.Forms.Panel pal_btn;
        private System.Windows.Forms.DataGridViewTextBoxColumn PurchasingStatus;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardStatus;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardNo;
        private System.Windows.Forms.DataGridViewTextBoxColumn StandardName;
        private System.Windows.Forms.DataGridViewTextBoxColumn FileName;
        private System.Windows.Forms.DataGridViewTextBoxColumn PublishDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn ImplementDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn RepealDate;
        private System.Windows.Forms.DataGridViewTextBoxColumn MessInfo;
    }
}

